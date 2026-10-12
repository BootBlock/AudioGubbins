/**
 * The Canvas 2D backend drawing a frame with a field among its geometry,
 * against contexts that record what they are asked.
 */

import { describe, expect, it } from 'vitest';

import { canvas2dBackend } from './canvas2d-backend.js';
import { FieldLookups } from './field-pixels.js';
import type { FieldBatch, RenderBatch, RenderFrame } from './render-frame.js';
import type { BackendEvents, RendererBackend } from './renderer-backend.js';

const EVENTS: BackendEvents = {
  lost: () => undefined,
  restored: () => undefined,
  failed: () => undefined,
};

/** A canvas whose 2D context answers `context`. */
function canvasWith(context: unknown): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.getContext = (() => context) as unknown as HTMLCanvasElement['getContext'];
  return canvas;
}

/** A context of `canvas` that records each call as its name and arguments. */
function recording(canvas: unknown = { width: 0, height: 0 }) {
  const calls: unknown[][] = [];
  const target: Record<string | symbol, unknown> = { canvas };
  const context = new Proxy(target, {
    get: (held, name): unknown =>
      name in held
        ? held[name]
        : (...args: unknown[]) => {
            calls.push([name, ...args]);
            return {
              width: Number(args[0]),
              height: Number(args[1]),
              data: new Uint8ClampedArray(64),
            };
          },
    set: (held, name, value): boolean => {
      held[name] = value;
      return true;
    },
  });
  return { context, calls };
}

/** The backend on a recording context, with an off-screen canvas that is counted when asked for. */
async function backendOf(offscreenGives: 'context' | 'nothing' = 'context') {
  const geometry = recording();
  let asked = 0;
  const offscreen = document.createElement('canvas');
  const composer = offscreenGives === 'context' ? recording(offscreen).context : null;
  offscreen.getContext = (() => composer) as unknown as HTMLCanvasElement['getContext'];
  const made = await canvas2dBackend(() => {
    asked += 1;
    return offscreen;
  }).create(canvasWith(geometry.context), EVENTS);
  if (!made.ok) throw new Error(made.failures[0].summary);
  const backend: RendererBackend = made.value;
  return { backend, calls: geometry.calls, offscreen, asked: () => asked };
}

const FIELD: FieldBatch = {
  kind: 'field',
  field: { key: 'field', width: 2, height: 2, values: new Uint8Array(4) },
  ramp: { key: 'ramp', colours: new Uint8Array(1024) },
  at: { x: 0.4, y: 0.2, width: 2.5, height: 2 },
  columns: { from: 0, to: 2 },
  rows: new Float32Array([0, 1, 1]),
};

const RECTANGLE: RenderBatch = {
  kind: 'rectangles',
  colour: [1, 1, 1, 1],
  values: new Float32Array([0, 0, 1, 1]),
  count: 1,
};

function frameOf(batches: readonly RenderBatch[]): RenderFrame {
  return {
    width: 4,
    height: 4,
    pixelRatio: 1.5,
    clear: [0, 0, 0, 1],
    layers: [{ clip: { x: 1.2, y: 0, width: 3, height: 3 }, batches }],
  };
}

describe('the Canvas 2D backend drawing a field', () => {
  it('draws it in its place among its layer’s geometry, over the pixels the shared rule gives', async () => {
    const { backend, calls, offscreen } = await backendOf();
    const frame = frameOf([RECTANGLE, FIELD, RECTANGLE]);
    const span = new FieldLookups().pack(frame).placements[0]?.span;
    if (span === undefined) throw new Error('The frame holds one field.');

    expect(backend.draw(frame)).toEqual({ kind: 'drawn' });

    const drawing = calls.flatMap(([name, ...args]): unknown[] => {
      if (name === 'clip' || name === 'fillRect') return [name];
      return name === 'drawImage' ? [['drawImage', ...args]] : [];
    });
    expect(drawing).toEqual([
      // The clear.
      'fillRect',
      'clip',
      'fillRect',
      // Outside the layer's clip, whose edge would shade a pixel it crosses.
      [
        'drawImage',
        offscreen,
        0,
        0,
        span.width,
        span.height,
        span.left,
        span.top,
        span.width,
        span.height,
      ],
      'clip',
      'fillRect',
    ]);
  });

  it('asks for no off-screen canvas while it draws no field', async () => {
    const { backend, asked } = await backendOf();

    backend.draw(frameOf([RECTANGLE]));
    backend.draw(frameOf([{ ...FIELD, at: { x: 5, y: 0, width: 1, height: 1 } }]));

    expect(asked()).toBe(0);
  });

  it('fails a draw whose field it has no canvas to compose on', async () => {
    const { backend } = await backendOf('nothing');

    expect(backend.draw(frameOf([FIELD]))).toEqual({
      kind: 'failed',
      reason: 'The browser gave no Canvas 2D context to compose a field on.',
    });
  });
});
