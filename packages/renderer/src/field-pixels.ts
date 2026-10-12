/**
 * Which device pixels a field batch paints, and which field cell each reads
 * (ADR-0082).
 *
 * Every backend draws a field through what this computes on the processor: the
 * span of device pixels, and a column map and a row map across it. A shader
 * only looks the cell up, so a backend's arithmetic can never put a boundary
 * one pixel from where another's puts it, and the three paint the same pixels
 * with the same cells.
 */

import { backingSize, type FieldBatch, type Rectangle, type RenderFrame } from './render-frame.js';

/** A rectangle of whole device pixels, from the canvas's top left; empty when either side is 0. */
export interface DeviceSpan {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** The first device pixel whose centre is at or after `edge`, in CSS pixels. */
function firstCentre(edge: number, ratio: number): number {
  return Math.ceil(edge * ratio - 0.5);
}

/**
 * The device pixels `at` paints within `clip` on a canvas of the frame's size:
 * those whose centres lie inside both, by `FieldBatch`'s rule.
 */
function fieldSpan(at: Rectangle, clip: Rectangle | undefined, frame: RenderFrame): DeviceSpan {
  const ratio = frame.pixelRatio;
  const size = backingSize(frame);
  let left = Math.max(0, firstCentre(at.x, ratio));
  let right = Math.min(size.width, firstCentre(at.x + at.width, ratio));
  let top = Math.max(0, firstCentre(at.y, ratio));
  let bottom = Math.min(size.height, firstCentre(at.y + at.height, ratio));
  if (clip !== undefined) {
    left = Math.max(left, firstCentre(clip.x, ratio));
    right = Math.min(right, firstCentre(clip.x + clip.width, ratio));
    top = Math.max(top, firstCentre(clip.y, ratio));
    bottom = Math.min(bottom, firstCentre(clip.y + clip.height, ratio));
  }
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/** `index` where it is a cell index below `count`, and -1 where it is not. */
function cell(index: number, count: number): number {
  return index >= 0 && index < count ? index : -1;
}

/**
 * Writes the field column each device column of `span` reads into `into` from
 * `offset`, one entry per column, -1 where it reads none.
 */
function mapColumns(
  batch: FieldBatch,
  pixelRatio: number,
  span: DeviceSpan,
  into: Float32Array,
  offset: number,
): void {
  const { at, columns, field } = batch;
  const perCssPixel = (columns.to - columns.from) / at.width;
  for (let index = 0; index < span.width; index += 1) {
    const centre = (span.left + index + 0.5) / pixelRatio;
    into[offset + index] = cell(
      Math.floor(columns.from + (centre - at.x) * perCssPixel),
      field.width,
    );
  }
}

/**
 * Writes the field row each device row of `span` reads into `into` from
 * `offset`, one entry per row, -1 where it reads none.
 */
function mapRows(
  batch: FieldBatch,
  pixelRatio: number,
  span: DeviceSpan,
  into: Float32Array,
  offset: number,
): void {
  const first = span.top - firstCentre(batch.at.y, pixelRatio);
  const { rows, field } = batch;
  for (let index = 0; index < span.height; index += 1) {
    // A row with no entry reads NaN, which is in no range, and is drawn as no row.
    into[offset + index] = cell(Math.floor(rows[first + index] ?? Number.NaN), field.height);
  }
}

/** One field batch of a frame: what it paints, and where its maps start in the lookups. */
export interface FieldPlacement {
  readonly batch: FieldBatch;
  readonly span: DeviceSpan;
  /** The index of its first column map entry in the lookups. */
  readonly columnsAt: number;
  /** The index of its first row map entry in the lookups. */
  readonly rowsAt: number;
}

/** A frame's field batches placed, and their column and row maps in one array. */
export interface FrameLookups {
  /** One per field batch, in the frame's draw order, layer by layer. */
  readonly placements: readonly FieldPlacement[];
  readonly values: Float32Array<ArrayBuffer>;
}

/**
 * The column and row maps of a frame's field batches, packed one after another
 * into one array that is grown as needed and kept (G4), so a backend uploads a
 * frame's maps at once.
 */
export class FieldLookups {
  #values = new Float32Array(4096);

  pack(frame: RenderFrame): FrameLookups {
    const placements: FieldPlacement[] = [];
    let total = 0;
    for (const layer of frame.layers) {
      for (const batch of layer.batches) {
        if (batch.kind !== 'field') continue;
        const span = fieldSpan(batch.at, layer.clip, frame);
        placements.push({ batch, span, columnsAt: total, rowsAt: total + span.width });
        total += span.width + span.height;
      }
    }
    if (this.#values.length < total) this.#values = new Float32Array(total * 2);
    for (const { batch, span, columnsAt, rowsAt } of placements) {
      mapColumns(batch, frame.pixelRatio, span, this.#values, columnsAt);
      mapRows(batch, frame.pixelRatio, span, this.#values, rowsAt);
    }
    return { placements, values: this.#values.subarray(0, total) };
  }
}

/** Whether a placement paints anything: a field with cells, over pixels on the canvas. */
export function paints(placement: FieldPlacement): boolean {
  const { span, batch } = placement;
  return span.width > 0 && span.height > 0 && batch.field.width > 0 && batch.field.height > 0;
}
