/**
 * The WebGL2 backend's loss and recovery, against a context that records what
 * it is asked and a schedule the test runs by hand, so a context taken away,
 * given back, never given back or given back unable to be rebuilt is each
 * driven on demand. What it draws is read in a real browser by the renderer
 * suites under `tests/e2e`.
 */

import { describe, expect, it } from 'vitest';

import { FieldLookups } from './field-pixels.js';
import type { ColourRamp, FieldBatch, RenderBatch, RenderFrame } from './render-frame.js';
import {
  AWAY,
  DRAWN,
  drawFailed,
  type BackendEvents,
  type RendererBackend,
  type Schedule,
} from './renderer-backend.js';
import { webGl2Backend } from './webgl2-context.js';

/** One rectangle, on a canvas four pixels by two. */
const FRAME: RenderFrame = {
  width: 4,
  height: 2,
  pixelRatio: 1,
  clear: [0, 0, 0, 1],
  layers: [
    {
      batches: [
        {
          kind: 'rectangles',
          colour: [1, 1, 1, 1],
          values: new Float32Array([0, 0, 1, 1]),
          count: 1,
        },
      ],
    },
  ],
};

/**
 * The state of a WebGL2 context: whether it is lost, whether its shaders
 * compile, and what it has built and drawn. Every call the backend makes that
 * this does not name is recorded, by name and arguments, and answers a fresh
 * object, which is all a handle is to it; every constant it does not name is
 * its own name.
 */
class GlState {
  lost = false;
  compiles = true;
  linked = 0;
  draws = 0;
  error = 0;
  maxTextureSize = 4096;
  readonly calls: unknown[][] = [];
  readonly NO_ERROR = 0;
  readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  isContextLost(): boolean {
    return this.lost;
  }

  getShaderParameter(): boolean {
    return this.compiles;
  }

  getShaderInfoLog(): string {
    return 'The shader did not compile.';
  }

  getProgramParameter(): boolean {
    return true;
  }

  linkProgram(): void {
    this.linked += 1;
  }

  drawArraysInstanced(...args: unknown[]): void {
    this.draws += 1;
    this.calls.push(['drawArraysInstanced', ...args]);
  }

  getError(): number {
    return this.error;
  }

  getExtension(): undefined {
    return undefined;
  }

  getParameter(name: unknown): unknown {
    return name === 'MAX_TEXTURE_SIZE' ? this.maxTextureSize : undefined;
  }

  /** The calls named `name`, by their arguments. */
  called(name: string): unknown[][] {
    return this.calls.filter(([called]) => called === name).map(([, ...args]) => args);
  }
}

/** A canvas whose WebGL2 context is `state`, and the events a backend on it sends. */
function glCanvas() {
  const canvas = document.createElement('canvas');
  const state = new GlState(canvas);
  const context = new Proxy(state, {
    get: (target, name): unknown => {
      if (name in target) return Reflect.get(target, name);
      if (typeof name === 'string' && /^[A-Z0-9_]+$/.test(name)) return name;
      return (...args: unknown[]): object => {
        target.calls.push([name, ...args]);
        return { name };
      };
    },
  }) as unknown as WebGL2RenderingContext;
  canvas.getContext = ((kind: string) =>
    kind === 'webgl2' ? context : null) as HTMLCanvasElement['getContext'];
  const said: string[] = [];
  const events: BackendEvents = {
    lost: (reason) => said.push(`lost: ${reason}`),
    restored: () => said.push('restored'),
    failed: (reason) => said.push(`failed: ${reason}`),
  };
  return { canvas, state, events, said };
}

/** A schedule the test runs by hand: what waits, and running it. */
function manualSchedule() {
  const waiting = new Set<{ readonly callback: () => void; readonly delayMs: number }>();
  const schedule: Schedule = (callback, delayMs) => {
    const entry = { callback, delayMs };
    waiting.add(entry);
    return () => {
      waiting.delete(entry);
    };
  };
  const run = (): void => {
    for (const entry of [...waiting]) {
      waiting.delete(entry);
      entry.callback();
    }
  };
  return { schedule, waiting, run };
}

async function made(
  canvas: HTMLCanvasElement,
  events: BackendEvents,
  schedule: Schedule,
  fieldBudget?: number,
): Promise<RendererBackend> {
  const result = await webGl2Backend(schedule, fieldBudget).create(canvas, events);
  if (!result.ok) throw new Error(result.failures[0].summary);
  return result.value;
}

function lose(canvas: HTMLCanvasElement, state: GlState): Event {
  state.lost = true;
  const event = new Event('webglcontextlost', { cancelable: true });
  canvas.dispatchEvent(event);
  return event;
}

function restore(canvas: HTMLCanvasElement, state: GlState): void {
  state.lost = false;
  canvas.dispatchEvent(new Event('webglcontextrestored'));
}

describe('the WebGL2 backend losing its context', () => {
  it('asks for the context back, and waits for it by the schedule it is given', async () => {
    const { canvas, state, events, said } = glCanvas();
    const timers = manualSchedule();
    await made(canvas, events, timers.schedule);

    const event = lose(canvas, state);

    expect(event.defaultPrevented).toBe(true);
    expect(said).toEqual(['lost: The browser took the WebGL2 context away.']);
    expect([...timers.waiting].map((entry) => entry.delayMs)).toEqual([3000]);
    timers.run();
    expect(said.at(-1)).toBe('failed: The WebGL2 context was not given back within 3 seconds.');
  });

  it('rebuilds on the context given back, calls off the wait, and says it is restored', async () => {
    const { canvas, state, events, said } = glCanvas();
    const timers = manualSchedule();
    await made(canvas, events, timers.schedule);

    lose(canvas, state);
    restore(canvas, state);

    expect(said.at(-1)).toBe('restored');
    expect(timers.waiting.size).toBe(0);
    // The geometry and field programs, each built once and again.
    expect(state.linked).toBe(4);
  });

  it('fails when the context given back cannot be rebuilt', async () => {
    const { canvas, state, events, said } = glCanvas();
    const timers = manualSchedule();
    await made(canvas, events, timers.schedule);

    lose(canvas, state);
    state.compiles = false;
    restore(canvas, state);

    expect(said.at(-1)).toBe(
      'failed: The WebGL2 context came back and could not be rebuilt: The shader did not compile.',
    );
  });
});

describe('the WebGL2 backend drawing', () => {
  it('draws nothing, and says the context is away, while it is lost', async () => {
    const { canvas, state, events } = glCanvas();
    const backend = await made(canvas, events, manualSchedule().schedule);

    lose(canvas, state);

    expect(backend.draw(FRAME)).toEqual(AWAY);
    expect(state.draws).toBe(0);
  });

  it('draws with what it rebuilt once the context is given back', async () => {
    const { canvas, state, events } = glCanvas();
    const backend = await made(canvas, events, manualSchedule().schedule);
    lose(canvas, state);
    restore(canvas, state);

    expect(backend.draw(FRAME)).toEqual(DRAWN);
    expect(state.draws).toBe(1);
  });

  it('fails the first draw with new resources that raises an error, and asks only once', async () => {
    const { canvas, state, events } = glCanvas();
    const backend = await made(canvas, events, manualSchedule().schedule);
    state.error = 1282;

    expect(backend.draw(FRAME)).toEqual(drawFailed('The first WebGL2 draw raised error 1282.'));
    expect(backend.draw(FRAME)).toEqual(DRAWN);
  });
});

const RAMP: ColourRamp = { key: 'ramp', colours: new Uint8Array(1024) };

/**
 * A field `width` by `height` whose cells count up from 0, drawn across `at`
 * with a field column and a field row to each CSS pixel.
 */
function fieldOf(
  key: string,
  width: number,
  height: number,
  at: FieldBatch['at'] = { x: 0, y: 0, width, height },
): FieldBatch {
  return {
    kind: 'field',
    field: { key, width, height, values: Uint8Array.from({ length: width * height }, (_, i) => i) },
    ramp: RAMP,
    at,
    columns: { from: 0, to: at.width },
    rows: Float32Array.from({ length: Math.ceil(at.height) }, (_, i) => i),
  };
}

const RECTANGLE: RenderBatch = {
  kind: 'rectangles',
  colour: [1, 1, 1, 1],
  values: new Float32Array([0, 0, 1, 1]),
  count: 1,
};

/** A frame four CSS pixels by two at one device pixel to each, of one layer. */
function frameOf(batches: readonly RenderBatch[], clip?: FieldBatch['at']): RenderFrame {
  return {
    width: 4,
    height: 2,
    pixelRatio: 1,
    clear: [0, 0, 0, 1],
    layers: [clip === undefined ? { batches } : { clip, batches }],
  };
}

/** How many times `batch`'s field has gone up. */
function uploads(state: GlState, batch: FieldBatch): number {
  return state.called('texSubImage2D').filter((args) => args.at(-1) === batch.field.values).length;
}

/** The pixel store in force at each upload of `batch`'s field. */
function unpacking(state: GlState, batch: FieldBatch): Record<string, unknown>[] {
  const stores: Record<string, unknown>[] = [];
  let store: Record<string, unknown> = {};
  for (const [name, ...args] of state.calls) {
    if (name === 'pixelStorei') store = { ...store, [String(args[0])]: args[1] };
    if (name === 'texSubImage2D' && args.at(-1) === batch.field.values) stores.push(store);
  }
  return stores;
}

describe('the WebGL2 backend drawing a field', () => {
  it('uploads a field once as one-byte textures and its ramp, and draws it over the pixels it paints', async () => {
    const { canvas, state, events } = glCanvas();
    const backend = await made(canvas, events, manualSchedule().schedule);
    const field = {
      ...fieldOf('a', 2, 2, { x: 0, y: 0, width: 4, height: 2 }),
      columns: { from: 0, to: 2 },
    };
    const frame = frameOf([field]);

    expect(backend.draw(frame)).toEqual(DRAWN);

    expect(state.called('texStorage2D')).toEqual([
      ['TEXTURE_2D', 1, 'R8', 2, 2],
      ['TEXTURE_2D', 1, 'RGBA8', 256, 1],
    ]);
    // A row of one-byte cells is as long as the field is wide, unpadded.
    expect(unpacking(state, field)).toEqual([
      { UNPACK_ALIGNMENT: 1, UNPACK_ROW_LENGTH: 2, UNPACK_SKIP_PIXELS: 0, UNPACK_SKIP_ROWS: 0 },
    ]);
    // The column map, two device columns to each field column, then the row map.
    const maps = state
      .called('texSubImage2D')
      .find((args) => args.includes('FLOAT'))
      ?.at(-1);
    expect(maps instanceof Float32Array ? [...maps] : maps).toEqual([0, 0, 1, 1, 0, 1]);
    expect(state.called('scissor').at(-1)).toEqual([0, 0, 4, 2]);
    expect(state.called('drawArrays')).toEqual([['TRIANGLES', 0, 3]]);

    backend.draw(frame);

    expect(uploads(state, field)).toBe(1);
    expect(state.called('texStorage2D')).toHaveLength(2);
    expect(state.called('drawArrays')).toHaveLength(2);
  });

  it('draws a field in its place among its layer’s geometry, which goes on in the layer’s scissor', async () => {
    const { canvas, state, events } = glCanvas();
    const backend = await made(canvas, events, manualSchedule().schedule);
    const clip = { x: 0, y: 0, width: 3, height: 2 };

    backend.draw(frameOf([RECTANGLE, fieldOf('a', 2, 2), RECTANGLE], clip));

    const drawing = state.calls.flatMap(([name, ...args]) => {
      if (name === 'scissor') return [`scissor ${args.join(' ')}`];
      return name === 'drawArrays' || name === 'drawArraysInstanced' ? [name] : [];
    });
    expect(drawing).toEqual([
      'scissor 0 0 3 2',
      'drawArraysInstanced',
      'scissor 0 0 2 2',
      'drawArrays',
      'scissor 0 0 3 2',
      'drawArraysInstanced',
    ]);
    const programs = state.called('useProgram').map(([program]) => program);
    expect(programs.at(-1)).toBe(programs.at(-3));
    expect(programs.at(-2)).not.toBe(programs.at(-1));
  });

  it('paints the device pixels the shared rule gives, by its scissor and origin', async () => {
    const { canvas, state, events } = glCanvas();
    const backend = await made(canvas, events, manualSchedule().schedule);
    const at = { x: 0.4, y: 0.2, width: 2.5, height: 2 };
    const clip = { x: 1.2, y: 0, width: 3, height: 3 };
    const frame: RenderFrame = {
      width: 4,
      height: 4,
      pixelRatio: 1.5,
      clear: [0, 0, 0, 1],
      layers: [{ clip, batches: [fieldOf('a', 4, 4, at)] }],
    };
    const span = new FieldLookups().pack(frame).placements[0]?.span;
    if (span === undefined) throw new Error('The frame holds one field.');

    backend.draw(frame);

    expect(span).toEqual({ left: 2, top: 0, width: 2, height: 3 });
    // Six device rows, counted from the bottom.
    expect(state.called('scissor').at(-1)).toEqual([
      span.left,
      6 - span.top - span.height,
      span.width,
      span.height,
    ]);
    expect(state.called('uniform2i')[0]?.slice(1)).toEqual([span.left, span.top]);
  });

  it('cuts a field wider and taller than the context takes into slices, and draws each', async () => {
    const { canvas, state, events } = glCanvas();
    state.maxTextureSize = 2;
    const backend = await made(canvas, events, manualSchedule().schedule);

    const field = fieldOf('a', 3, 3, { x: 0, y: 0, width: 3, height: 2 });
    backend.draw(frameOf([field]));

    expect(state.called('texStorage2D').filter((args) => args[2] === 'R8')).toEqual([
      ['TEXTURE_2D', 1, 'R8', 2, 2],
      ['TEXTURE_2D', 1, 'R8', 1, 2],
      ['TEXTURE_2D', 1, 'R8', 2, 1],
      ['TEXTURE_2D', 1, 'R8', 1, 1],
    ]);
    // Each slice read from the field's own bytes, at its offset.
    const skips = unpacking(state, field).map((store) => [
      store['UNPACK_SKIP_PIXELS'],
      store['UNPACK_SKIP_ROWS'],
    ]);
    expect(skips).toEqual([
      [0, 0],
      [2, 0],
      [0, 2],
      [2, 2],
    ]);
    expect(state.called('uniform4i').map((args) => args.slice(1))).toEqual([
      [0, 0, 2, 2],
      [2, 0, 1, 2],
      [0, 2, 2, 1],
      [2, 2, 1, 1],
    ]);
    expect(state.called('drawArrays')).toHaveLength(4);
  });

  it('keeps fields within its budget, letting the least recently drawn go first', async () => {
    const { canvas, state, events } = glCanvas();
    const backend = await made(canvas, events, manualSchedule().schedule, 8);
    const a = fieldOf('a', 2, 2);
    const b = fieldOf('b', 2, 2);
    const c = fieldOf('c', 2, 2);

    backend.draw(frameOf([a, b]));
    backend.draw(frameOf([c]));

    expect(state.called('deleteTexture')).toHaveLength(1);
    backend.draw(frameOf([b]));
    backend.draw(frameOf([a]));

    expect([uploads(state, a), uploads(state, b), uploads(state, c)]).toEqual([2, 1, 1]);
  });

  it('draws a field larger than its whole budget, then lets it go and keeps the rest', async () => {
    const { canvas, state, events } = glCanvas();
    const backend = await made(canvas, events, manualSchedule().schedule, 3);
    const small = fieldOf('small', 1, 1);
    const large = fieldOf('large', 2, 2);

    backend.draw(frameOf([small, large]));

    expect(state.called('drawArrays')).toHaveLength(2);
    expect(state.called('deleteTexture')).toHaveLength(1);
    backend.draw(frameOf([small, large]));
    expect([uploads(state, small), uploads(state, large)]).toEqual([1, 2]);
  });

  it('uploads its fields again after the context it held them on is lost and given back', async () => {
    const { canvas, state, events } = glCanvas();
    const backend = await made(canvas, events, manualSchedule().schedule);
    const field = fieldOf('a', 2, 2);
    backend.draw(frameOf([field]));

    lose(canvas, state);
    restore(canvas, state);
    backend.draw(frameOf([field]));

    expect(uploads(state, field)).toBe(2);
    expect(state.called('texStorage2D').filter((args) => args[2] === 'RGBA8')).toHaveLength(2);
  });

  it('makes no texture for a field it does not draw', async () => {
    const { canvas, state, events } = glCanvas();
    const backend = await made(canvas, events, manualSchedule().schedule);

    backend.draw(frameOf([fieldOf('off the canvas', 2, 2, { x: 5, y: 0, width: 2, height: 2 })]));
    backend.draw(frameOf([fieldOf('clipped away', 2, 2)], { x: 3, y: 0, width: 1, height: 2 }));
    backend.draw(frameOf([fieldOf('no cells', 0, 2)]));

    expect(state.called('texStorage2D')).toEqual([]);
    expect(state.called('drawArrays')).toEqual([]);
  });
});
