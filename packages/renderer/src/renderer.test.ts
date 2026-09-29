/**
 * The renderer's choice of backend and its recovery, against backends that
 * record what they are asked, so a lost device, a context that comes back and
 * one that does not are each driven on demand. The backends themselves are
 * driven in a real browser by `tests/e2e/renderer-loss.spec.ts`.
 */

import { describe, expect, it } from 'vitest';

import { FailureKind, fail, failure, succeed } from '@audiogubbins/domain';

import { browserBackends } from './backends.js';
import type { Painter } from './canvas-painting.js';
import type { RenderFrame } from './render-frame.js';
import {
  AWAY,
  DRAWN,
  RendererKind,
  drawFailed,
  type BackendEvents,
  type BackendFactory,
  type RendererBackend,
} from './renderer-backend.js';
import { Renderer, RendererState, type OverlayEvents, type RendererReport } from './renderer.js';

/** A schedule that never runs what it is given, for backends these tests do not lose. */
const NO_WAIT = (): (() => void) => () => undefined;

/** Lets every promise the renderer is waiting on settle. */
function settled(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function frame(width: number): RenderFrame {
  return { width, height: 10, pixelRatio: 1, clear: [0, 0, 0, 1], layers: [] };
}

/** A backend factory that records what it is given and drawn, and hands out its events. */
class FakeFactory implements BackendFactory {
  readonly drawn: RenderFrame[] = [];
  readonly canvases: HTMLCanvasElement[] = [];
  events: BackendEvents | undefined;
  disposed = 0;
  /** Whether the device is there to draw with. */
  drawing = true;
  /** Why the backend cannot draw, where it cannot. */
  failing: string | undefined;

  readonly kind: RendererKind;
  readonly refusal: string | undefined;

  constructor(kind: RendererKind, refusal?: string) {
    this.kind = kind;
    this.refusal = refusal;
  }

  create(canvas: HTMLCanvasElement, events: BackendEvents) {
    this.canvases.push(canvas);
    if (this.refusal !== undefined) {
      return Promise.resolve(
        fail(failure('fake.refused', FailureKind.Unrecoverable, this.refusal)),
      );
    }
    this.events = events;
    const backend: RendererBackend = {
      kind: this.kind,
      draw: (drawn) => {
        if (this.failing !== undefined) return drawFailed(this.failing);
        if (!this.drawing) return AWAY;
        this.drawn.push(drawn);
        return DRAWN;
      },
      dispose: () => {
        this.disposed += 1;
      },
    };
    return Promise.resolve(succeed(backend));
  }
}

/**
 * A surface whose overlay counts the frames painted on it, as a context does:
 * one lost paints nothing, and one given back is blank. It hands out the events
 * that say so, which the test sends with `lose` and `restore`.
 */
function surface() {
  const canvases: HTMLCanvasElement[] = [];
  const overlay = {
    paints: 0,
    lost: false,
    watching: 0,
    events: undefined as OverlayEvents | undefined,
    lose: () => {
      overlay.lost = true;
      overlay.events?.lost();
    },
    restore: () => {
      overlay.lost = false;
      overlay.events?.restored();
    },
  };
  const painter = new Proxy(
    {},
    {
      get: (_target, name): unknown =>
        name === 'clearRect'
          ? () => {
              if (!overlay.lost) overlay.paints += 1;
            }
          : () => undefined,
      set: () => true,
    },
  ) as Painter;
  return {
    canvases,
    overlayState: overlay,
    freshCanvas: () => {
      const canvas = document.createElement('canvas');
      canvases.push(canvas);
      return canvas;
    },
    overlay: (): Painter | undefined => painter,
    watchOverlay: (events: OverlayEvents) => {
      overlay.events = events;
      overlay.watching += 1;
      return () => {
        overlay.watching -= 1;
      };
    },
  };
}

describe('choosing a backend', () => {
  it('draws with the first backend that is made, each on a fresh canvas, and reports every refusal', async () => {
    const gpu = new FakeFactory(RendererKind.WebGpu, 'The browser gave no WebGPU adapter.');
    const gl = new FakeFactory(RendererKind.WebGl2);
    const plain = new FakeFactory(RendererKind.Canvas2d);
    const place = surface();
    const renderer = new Renderer({ surface: place, backends: [gpu, gl, plain] });
    renderer.draw(frame(1));
    await renderer.start();
    expect(renderer.report).toEqual({
      state: RendererState.Drawing,
      active: RendererKind.WebGl2,
      attempts: [
        {
          kind: RendererKind.WebGpu,
          outcome: 'refused',
          reason: 'The browser gave no WebGPU adapter.',
        },
        { kind: RendererKind.WebGl2, outcome: 'active' },
      ],
      losses: 0,
      recoveries: 0,
    });
    expect(gl.drawn).toEqual([frame(1)]);
    expect(gpu.canvases[0]).not.toBe(gl.canvases[0]);
    expect(plain.canvases).toEqual([]);
  });

  it('says it is unavailable, with every reason, when no backend can be made', async () => {
    const renderer = new Renderer({
      surface: surface(),
      backends: [
        new FakeFactory(RendererKind.WebGl2, 'No WebGL2.'),
        new FakeFactory(RendererKind.Canvas2d, 'No 2D.'),
      ],
    });
    await renderer.start();
    expect(renderer.report.state).toBe(RendererState.Unavailable);
    expect(renderer.report.attempts.map((attempt) => attempt.reason)).toEqual([
      'No WebGL2.',
      'No 2D.',
    ]);
  });

  it('lists WebGPU as refused, with the reason, in a browser that does not offer it', async () => {
    const [first] = browserBackends(undefined, NO_WAIT);
    const made = await first!.create(document.createElement('canvas'), {
      lost: () => undefined,
      restored: () => undefined,
      failed: () => undefined,
    });
    expect(first?.kind).toBe(RendererKind.WebGpu);
    expect(made.ok ? undefined : made.failures[0].summary).toBe(
      'This browser does not offer WebGPU.',
    );
    expect(
      browserBackends({ requestAdapter: 'no' }, NO_WAIT).map((factory) => factory.kind),
    ).toEqual([RendererKind.WebGpu, RendererKind.WebGl2, RendererKind.Canvas2d]);
  });
});

describe('recovering from a lost device', () => {
  it('waits while the context is lost, and draws the latest frame again when it is restored', async () => {
    const gl = new FakeFactory(RendererKind.WebGl2);
    const renderer = new Renderer({ surface: surface(), backends: [gl] });
    await renderer.start();
    renderer.draw(frame(1));
    gl.drawing = false;
    gl.events?.lost('The browser took the WebGL2 context away.');
    renderer.draw(frame(2));
    expect(renderer.report.state).toBe(RendererState.Recovering);
    gl.drawing = true;
    gl.events?.restored();
    expect(gl.drawn).toEqual([frame(1), frame(2)]);
    expect(renderer.report).toMatchObject({
      state: RendererState.Drawing,
      losses: 1,
      recoveries: 1,
    });
    expect(renderer.report.attempts.at(-1)).toEqual({
      kind: RendererKind.WebGl2,
      outcome: 'lost',
      reason: 'The browser took the WebGL2 context away.',
    });
  });

  it('steps down to the next backend when the context does not come back, and draws the latest frame there', async () => {
    const gpu = new FakeFactory(RendererKind.WebGpu);
    const gl = new FakeFactory(RendererKind.WebGl2);
    const renderer = new Renderer({ surface: surface(), backends: [gpu, gl] });
    await renderer.start();
    renderer.draw(frame(3));
    gpu.events?.failed('The browser gave no adapter after the loss.');
    await Promise.resolve();
    await Promise.resolve();
    expect(gpu.disposed).toBe(1);
    expect(gl.drawn).toEqual([frame(3)]);
    expect(renderer.report).toMatchObject({
      state: RendererState.Drawing,
      active: RendererKind.WebGl2,
      recoveries: 1,
    });
  });

  it('ignores what a backend it no longer draws with says', async () => {
    const gpu = new FakeFactory(RendererKind.WebGpu);
    const gl = new FakeFactory(RendererKind.WebGl2);
    const renderer = new Renderer({ surface: surface(), backends: [gpu, gl] });
    await renderer.start();
    gpu.events?.failed('Gone.');
    await Promise.resolve();
    await Promise.resolve();
    const report = renderer.report;
    gpu.events?.lost('Late.');
    gpu.events?.restored();
    expect(renderer.report).toBe(report);
  });

  it('disposes a backend made after it was disposed itself', async () => {
    const gl = new FakeFactory(RendererKind.WebGl2);
    const renderer = new Renderer({ surface: surface(), backends: [gl] });
    const starting = renderer.start();
    renderer.dispose();
    await starting;
    expect(gl.disposed).toBe(1);
    expect(renderer.report.state).toBe(RendererState.Starting);
  });
});

describe('a backend that cannot draw', () => {
  it('is not counted as recovered when it cannot draw after a restore, and the next kind draws instead', async () => {
    const gl = new FakeFactory(RendererKind.WebGl2);
    const plain = new FakeFactory(RendererKind.Canvas2d);
    const renderer = new Renderer({ surface: surface(), backends: [gl, plain] });
    await renderer.start();
    renderer.draw(frame(1));
    gl.events?.lost('The browser took the WebGL2 context away.');
    gl.failing = 'The WebGL2 context is back, and the backend has nothing to draw with.';
    const reports: RendererReport[] = [];
    renderer.subscribe((report) => reports.push(report));

    gl.events?.restored();
    await settled();

    expect(
      reports.some(
        (report) => report.active === RendererKind.WebGl2 && report.state === RendererState.Drawing,
      ),
    ).toBe(false);
    expect(renderer.report.attempts.at(-2)).toEqual({
      kind: RendererKind.WebGl2,
      outcome: 'failed',
      reason: 'The WebGL2 context is back, and the backend has nothing to draw with.',
    });
    expect(gl.disposed).toBe(1);
    expect(plain.drawn).toEqual([frame(1)]);
    expect(renderer.report).toMatchObject({
      state: RendererState.Drawing,
      active: RendererKind.Canvas2d,
      losses: 1,
      recoveries: 1,
    });
  });

  it('says it is unavailable, having recovered nothing, when no other kind can draw', async () => {
    const gl = new FakeFactory(RendererKind.WebGl2);
    const renderer = new Renderer({ surface: surface(), backends: [gl] });
    await renderer.start();
    renderer.draw(frame(1));
    gl.events?.lost('The browser took the WebGL2 context away.');
    gl.failing = 'The first WebGL2 draw raised error 1282.';

    gl.events?.restored();
    await settled();

    expect(renderer.report).toMatchObject({
      state: RendererState.Unavailable,
      active: undefined,
      losses: 1,
      recoveries: 0,
    });
  });

  it('is replaced by the next kind when a draw fails, which draws the frame', async () => {
    const gl = new FakeFactory(RendererKind.WebGl2);
    const plain = new FakeFactory(RendererKind.Canvas2d);
    const renderer = new Renderer({ surface: surface(), backends: [gl, plain] });
    await renderer.start();
    gl.failing = 'The first WebGL2 draw raised error 1282.';

    renderer.draw(frame(4));
    await settled();

    expect(renderer.report.attempts.map(({ kind, outcome }) => `${kind} ${outcome}`)).toEqual([
      'webgl2 active',
      'webgl2 failed',
      'canvas-2d active',
    ]);
    expect(plain.drawn).toEqual([frame(4)]);
    expect(renderer.report.active).toBe(RendererKind.Canvas2d);
  });

  it('is not taken when it cannot draw the first frame', async () => {
    const gl = new FakeFactory(RendererKind.WebGl2);
    const plain = new FakeFactory(RendererKind.Canvas2d);
    gl.failing = 'The first WebGL2 draw raised error 1282.';
    const renderer = new Renderer({ surface: surface(), backends: [gl, plain] });
    renderer.draw(frame(5));

    await renderer.start();

    expect(renderer.report.attempts).toEqual([
      {
        kind: RendererKind.WebGl2,
        outcome: 'failed',
        reason: 'The first WebGL2 draw raised error 1282.',
      },
      { kind: RendererKind.Canvas2d, outcome: 'active' },
    ]);
    expect(gl.disposed).toBe(1);
    expect(plain.drawn).toEqual([frame(5)]);
  });
});

describe('the overlay above the geometry', () => {
  it('paints the latest frame again when the overlay is given back after the geometry', async () => {
    const gl = new FakeFactory(RendererKind.WebGl2);
    const place = surface();
    const renderer = new Renderer({ surface: place, backends: [gl] });
    await renderer.start();
    renderer.draw(frame(1));
    expect(place.overlayState.paints).toBe(1);

    // One GPU process crash takes both; the geometry comes back first.
    place.overlayState.lose();
    gl.events?.lost('The browser took the WebGL2 context away.');
    renderer.draw(frame(2));
    gl.events?.restored();
    expect(gl.drawn).toEqual([frame(1), frame(2)]);

    place.overlayState.restore();

    expect(place.overlayState.paints).toBe(2);
  });

  it('leaves the overlay to the geometry’s recovery when the overlay is given back first', async () => {
    const gl = new FakeFactory(RendererKind.WebGl2);
    const place = surface();
    const renderer = new Renderer({ surface: place, backends: [gl] });
    await renderer.start();
    renderer.draw(frame(1));
    place.overlayState.lose();
    gl.events?.lost('The browser took the WebGL2 context away.');

    place.overlayState.restore();
    expect(place.overlayState.paints).toBe(1);
    gl.events?.restored();

    expect(place.overlayState.paints).toBe(2);
  });

  it('stops watching the overlay when it is disposed', () => {
    const place = surface();
    const renderer = new Renderer({ surface: place, backends: [] });
    expect(place.overlayState.watching).toBe(1);

    renderer.dispose();

    expect(place.overlayState.watching).toBe(0);
  });
});
