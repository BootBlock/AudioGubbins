/**
 * Field batches on Canvas 2D: the image composed off screen, pixel by pixel,
 * and drawn one for one over the geometry, against contexts that record what
 * they are asked.
 */

import { describe, expect, it } from 'vitest';

import { CanvasFields, type Composer } from './canvas-fields.js';
import type { Painter } from './canvas-painting.js';
import { FieldLookups } from './field-pixels.js';
import type { FieldBatch, RenderFrame } from './render-frame.js';

/** A composer whose images are plain arrays, and the calls made of it. */
function composing() {
  const calls: unknown[][] = [];
  const canvas = document.createElement('canvas');
  const composer = {
    canvas,
    createImageData: (width: number, height: number) => {
      calls.push(['createImageData', width, height]);
      return { width, height, data: new Uint8ClampedArray(width * height * 4) };
    },
    putImageData: (...args: unknown[]) => {
      calls.push(['putImageData', ...args]);
    },
  } as unknown as Composer;
  canvas.getContext = (() => composer) as unknown as HTMLCanvasElement['getContext'];
  let asked = 0;
  const offscreen = (): HTMLCanvasElement => {
    asked += 1;
    return canvas;
  };
  return { canvas, calls, offscreen, asked: () => asked };
}

/** A painter that records each call as its name and arguments. */
function painting(): { painter: Painter; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  const painter = {
    save: record('save'),
    restore: record('restore'),
    setTransform: record('setTransform'),
    drawImage: record('drawImage'),
  } as unknown as Painter;
  return { painter, calls };
}

/**
 * A ramp whose entry `v` is `10v + 1`, `10v + 2`, `10v + 3` and opaque, but
 * for entry 3, which is half transparent.
 */
function ramp(): Uint8Array<ArrayBuffer> {
  const colours = new Uint8Array(1024);
  for (let value = 0; value < 256; value += 1) {
    colours.set(
      [10 * value + 1, 10 * value + 2, 10 * value + 3, value === 3 ? 128 : 255],
      value * 4,
    );
  }
  return colours;
}

/** A field of cells 0, 1, 2 and 3, two by two, across three CSS pixels by two. */
const FIELD: FieldBatch = {
  kind: 'field',
  field: { key: 'field', width: 2, height: 2, values: new Uint8Array([0, 1, 2, 3]) },
  ramp: { key: 'ramp', colours: ramp() },
  at: { x: 0, y: 0, width: 3, height: 2 },
  // One field column to each device column, the third past the field.
  columns: { from: 0, to: 3 },
  // The field's second row, then none.
  rows: new Float32Array([1, -1]),
};

function placed(batch: FieldBatch, width = 3) {
  const frame: RenderFrame = {
    width,
    height: 2,
    pixelRatio: 1,
    clear: [0, 0, 0, 1],
    layers: [{ batches: [batch] }],
  };
  const { placements, values } = new FieldLookups().pack(frame);
  const [placement] = placements;
  if (placement === undefined) throw new Error('The frame holds a field.');
  return { placement, values };
}

describe('a field painted with Canvas 2D', () => {
  it('composes the colour of each cell its pixels read, and clear where they read none', () => {
    const { calls, offscreen, canvas } = composing();
    const { painter, calls: painted } = painting();
    const { placement, values } = placed(FIELD);

    expect(new CanvasFields(offscreen).paint(painter, placement, values)).toBe(true);

    const put = calls.find(([name]) => name === 'putImageData');
    const image = put?.[1] as ImageData;
    expect(put?.slice(2)).toEqual([0, 0, 0, 0, 3, 2]);
    expect([...image.data]).toEqual([
      // The field's row 1: cells 2 and 3, then a column past the field.
      21, 22, 23, 255, 31, 32, 33, 128, 0, 0, 0, 0,
      // A row that reads no field row.
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    // Drawn one device pixel for one, so it blends over what is there and nothing is resampled.
    expect(painted).toEqual([
      ['save'],
      ['setTransform', 1, 0, 0, 1, 0, 0],
      ['drawImage', canvas, 0, 0, 3, 2, 0, 0, 3, 2],
      ['restore'],
    ]);
  });

  it('asks for its canvas once, on the first field, and keeps its image until a field outgrows it', () => {
    const { calls, offscreen, asked } = composing();
    const { painter } = painting();
    const fields = new CanvasFields(offscreen);
    expect(asked()).toBe(0);

    const small = placed(FIELD, 2);
    fields.paint(painter, small.placement, small.values);
    fields.paint(painter, small.placement, small.values);
    const large = placed(FIELD, 3);
    fields.paint(painter, large.placement, large.values);

    expect(asked()).toBe(1);
    expect(calls.filter(([name]) => name === 'createImageData')).toEqual([
      ['createImageData', 2, 2],
      ['createImageData', 3, 2],
    ]);
  });

  it('clears what an earlier field left in its kept image where a later one reads nothing', () => {
    const { calls, offscreen } = composing();
    const { painter } = painting();
    const fields = new CanvasFields(offscreen);
    const opaque = placed({
      ...FIELD,
      rows: new Float32Array([1, 0]),
      columns: { from: 0, to: 2 },
    });
    fields.paint(painter, opaque.placement, opaque.values);

    const empty = placed({
      ...FIELD,
      rows: new Float32Array([1, -1]),
      columns: { from: 2, to: 5 },
    });
    fields.paint(painter, empty.placement, empty.values);

    const image = calls.findLast(([name]) => name === 'putImageData')?.[1] as ImageData;
    expect([...image.data]).toEqual(new Array<number>(24).fill(0));
  });

  it('composes on a new canvas once the browser takes away the context it composed on', () => {
    // The browser gives the geometry's context back before this one's, and
    // what is composed on a canvas still lost draws nothing.
    const made: ReturnType<typeof composing>[] = [];
    const offscreen = (): HTMLCanvasElement => {
      const next = composing();
      made.push(next);
      return next.offscreen();
    };
    const { painter, calls: painted } = painting();
    const fields = new CanvasFields(offscreen);
    const { placement, values } = placed(FIELD);
    fields.paint(painter, placement, values);

    made[0]?.canvas.dispatchEvent(new Event('contextlost'));
    fields.paint(painter, placement, values);
    fields.paint(painter, placement, values);

    expect(made).toHaveLength(2);
    const [first, second] = made;
    expect(first?.calls.filter(([name]) => name === 'putImageData')).toHaveLength(1);
    expect(second?.calls.filter(([name]) => name === 'putImageData')).toHaveLength(2);
    expect(painted.filter(([name]) => name === 'drawImage').map(([, canvas]) => canvas)).toEqual([
      first?.canvas,
      second?.canvas,
      second?.canvas,
    ]);
  });

  it('answers that it could not paint when its canvas gives no context', () => {
    const canvas = document.createElement('canvas');
    canvas.getContext = () => null;
    const { placement, values } = placed(FIELD);

    expect(new CanvasFields(() => canvas).paint(painting().painter, placement, values)).toBe(false);
  });
});
