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
  RendererKind,
  type BackendEvents,
  type BackendFactory,
  type RendererBackend,
} from './renderer-backend.js';
import { Renderer, RendererState } from './renderer.js';

function frame(width: number): RenderFrame {
  return { width, height: 10, pixelRatio: 1, clear: [0, 0, 0, 1], layers: [] };
}

/** A backend factory that records what it is given and drawn, and hands out its events. */
class FakeFactory implements BackendFactory {
  readonly drawn: RenderFrame[] = [];
  readonly canvases: HTMLCanvasElement[] = [];
  events: BackendEvents | undefined;
  disposed = 0;
  drawing = true;

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
        if (!this.drawing) return false;
        this.drawn.push(drawn);
        return true;
      },
      dispose: () => {
        this.disposed += 1;
      },
    };
    return Promise.resolve(succeed(backend));
  }
}

function surface() {
  const canvases: HTMLCanvasElement[] = [];
  return {
    canvases,
    freshCanvas: () => {
      const canvas = document.createElement('canvas');
      canvases.push(canvas);
      return canvas;
    },
    overlay: (): Painter | undefined => undefined,
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
    const [first] = browserBackends(undefined);
    const made = await first!.create(document.createElement('canvas'), {
      lost: () => undefined,
      restored: () => undefined,
      failed: () => undefined,
    });
    expect(first?.kind).toBe(RendererKind.WebGpu);
    expect(made.ok ? undefined : made.failures[0].summary).toBe(
      'This browser does not offer WebGPU.',
    );
    expect(browserBackends({ requestAdapter: 'no' }).map((factory) => factory.kind)).toEqual([
      RendererKind.WebGpu,
      RendererKind.WebGl2,
      RendererKind.Canvas2d,
    ]);
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
