/**
 * Drawing a spectral mask over a lane (ADR-0082): its weight, sampled at
 * every device pixel from the domain's own reading of it, as a field through
 * a ramp of one colour, and the outline of each of its shapes as it was
 * drawn, a rectangle's edges, a lasso's closed path and a brush's path.
 *
 * The weight has one home, the domain's `MaskWeights` (ADR-0081): the view
 * reads it there column by column, a column of pixels being a row of the
 * mask's bins, so what is drawn is what an edit of the selection changes and
 * nothing the view works out for itself. A column's position and a pixel's
 * frequency are the exact inverses of where the view draws a position and a
 * frequency, so the weight, the outline and the spectrogram under them share
 * one mapping at every zoom.
 *
 * The weight of a lane is worked out again only where what it is drawn from
 * has changed, so a still selection costs nothing from frame to frame; a
 * field it has made keeps its key, and a backend draws it from the texture
 * it holds.
 */

import {
  MaskWeights,
  maskSupport,
  type SpectralMask,
  type SpectralShape,
} from '@audiogubbins/domain';
import type { Colour, ColourRamp, FieldBatch, RenderBatch } from '@audiogubbins/renderer';
import { pixelOf, type ViewportState } from '@audiogubbins/timeline';

import type { SegmentBuilder } from './batch-buffers.js';
import { frequencyAt, frequencyY } from './frequency-axis.js';
import type { Lane } from './lane-layout.js';
import type { SpectralSettings } from './view-state.js';

/**
 * Where a spectral edit of the asset applies, placed on the view's timeline:
 * its mask, stated relative to `from`, as an edit's mask is relative to the
 * start of its range, and the channels it acts on, every channel where absent.
 * `from` may lie before the view's first boundary, as an edit that begins
 * before a region does in the region's view.
 */
export interface SpectralEditOutline {
  readonly mask: SpectralMask;
  readonly from: number;
  readonly channels?: readonly number[];
}

/**
 * Outlines each shape of `mask` into `builder`, `x` and `y` placing a
 * position and a frequency in the lane: a rectangle by its four edges, a
 * lasso by its path closed back to its first point, and a brush stroke by its
 * path, so a shape taken from a mask is seen where it was taken.
 */
export function outlineMask(
  builder: SegmentBuilder,
  mask: SpectralMask,
  x: (position: number) => number,
  y: (frequency: number) => number,
): void {
  for (const shape of mask.shapes) outlineShape(builder, shape, x, y);
}

function outlineShape(
  builder: SegmentBuilder,
  shape: SpectralShape,
  x: (position: number) => number,
  y: (frequency: number) => number,
): void {
  if (shape.kind === 'rectangle') {
    const x0 = x(shape.range.start);
    const x1 = x(shape.range.end);
    const y0 = y(shape.band.high);
    const y1 = y(shape.band.low);
    builder.add(x0, y0, x1, y0);
    builder.add(x1, y0, x1, y1);
    builder.add(x1, y1, x0, y1);
    builder.add(x0, y1, x0, y0);
    return;
  }
  const { points } = shape;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    if (from === undefined || to === undefined) continue;
    builder.add(x(from.position), y(from.frequency), x(to.position), y(to.frequency));
  }
  if (shape.kind === 'polygon') {
    const [first] = points;
    const last = points[points.length - 1] ?? first;
    builder.add(x(last.position), y(last.frequency), x(first.position), y(first.frequency));
  }
}

/** The first device pixel whose centre is at or after `edge`, in CSS pixels. */
function firstCentre(edge: number, ratio: number): number {
  return Math.ceil(edge * ratio - 0.5);
}

/** What a lane's weight field was worked out from, compared field by field. */
interface FieldSource {
  readonly mask: SpectralMask;
  readonly lane: Lane;
  readonly axis: SpectralSettings;
  readonly viewport: ViewportState;
  readonly pixelRatio: number;
}

function sameSource(one: FieldSource, other: FieldSource): boolean {
  const a = one.lane.area;
  const b = other.lane.area;
  const v = one.viewport;
  const w = other.viewport;
  return (
    one.mask === other.mask &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    one.axis.frequencyScale === other.axis.frequencyScale &&
    one.axis.lowest === other.axis.lowest &&
    one.axis.highest === other.axis.highest &&
    v.start === w.start &&
    v.offset === w.offset &&
    v.width === w.width &&
    v.zoom.kind === w.zoom.kind &&
    (v.zoom.kind === 'samples-per-pixel'
      ? w.zoom.kind === 'samples-per-pixel' && v.zoom.samples === w.zoom.samples
      : w.zoom.kind === 'pixels-per-sample' && v.zoom.pixels === w.zoom.pixels) &&
    one.pixelRatio === other.pixelRatio
  );
}

/** A lane's weight field, and what it was worked out from. */
interface LaneField {
  readonly source: FieldSource;
  /** The weight field, or none where the mask weighs nothing in view. */
  readonly field: Omit<FieldBatch, 'ramp'> | undefined;
}

/** The ramp of `colour`: entry `v` is the colour at `v / 255` of its opacity. */
function rampOf(colour: Colour): ColourRamp {
  const [red, green, blue, alpha] = colour;
  const colours = new Uint8Array(1024);
  for (let value = 0; value < 256; value += 1) {
    colours[value * 4] = Math.round(red * 255);
    colours[value * 4 + 1] = Math.round(green * 255);
    colours[value * 4 + 2] = Math.round(blue * 255);
    colours[value * 4 + 3] = Math.round((alpha * 255 * value) / 255);
  }
  return { key: `spectral-mask:${colour.join(',')}`, colours };
}

/**
 * Draws masks' weights, keeping each lane's field from frame to frame while
 * what it is drawn from stays the same.
 */
export class MaskPainter {
  /** The field each lane drawn last frame showed, by the order it was drawn in. */
  #fields: (LaneField | undefined)[] = [];
  #next = 0;
  #made = 0;
  readonly #ramps = new WeakMap<Colour, ColourRamp>();

  /** Starts a frame. */
  begin(): void {
    this.#next = 0;
  }

  /**
   * Draws `mask`'s weight over `lane` in `colour`, the one weight field the
   * lane shows this frame.
   */
  draw(
    lane: Lane,
    mask: SpectralMask,
    axis: SpectralSettings,
    view: { readonly viewport: ViewportState; readonly pixelRatio: number },
    colour: Colour,
    out: RenderBatch[],
  ): void {
    const slot = this.#next;
    this.#next += 1;
    const source: FieldSource = { mask, lane, axis, ...view };
    const kept = this.#fields[slot];
    const known = kept !== undefined && sameSource(kept.source, source) ? kept : undefined;
    const made = known ?? { source, field: this.#weighed(source) };
    this.#fields[slot] = made;
    if (made.field === undefined) return;
    out.push({ ...made.field, ramp: this.#ramp(colour) });
  }

  #ramp(colour: Colour): ColourRamp {
    const known = this.#ramps.get(colour);
    if (known !== undefined) return known;
    const ramp = rampOf(colour);
    this.#ramps.set(colour, ramp);
    return ramp;
  }

  /** The weight of `source.mask` at each device pixel of the lane its support reaches. */
  #weighed(source: FieldSource): Omit<FieldBatch, 'ramp'> | undefined {
    const { mask, lane, axis, viewport, pixelRatio: ratio } = source;
    const { area } = lane;
    const support = maskSupport(mask);
    const left = Math.max(
      firstCentre(area.x, ratio),
      Math.floor(pixelOf(viewport, support.start) * ratio),
    );
    const right = Math.min(
      firstCentre(area.x + area.width, ratio),
      Math.ceil(pixelOf(viewport, support.end) * ratio),
    );
    const top = Math.max(
      firstCentre(area.y, ratio),
      Math.floor(frequencyY(lane, support.high, axis) * ratio),
    );
    const bottom = Math.min(
      firstCentre(area.y + area.height, ratio),
      Math.ceil(frequencyY(lane, support.low, axis) * ratio),
    );
    const width = right - left;
    const height = bottom - top;
    if (width <= 0 || height <= 0) return undefined;

    // A column's position, where its centre falls: the inverse of `pixelOf`,
    // which is linear in the position.
    const origin = pixelOf(viewport, viewport.start);
    const perSample = pixelOf(viewport, viewport.start + 1) - origin;
    // A row's frequency at its centre, lowest first, as the weights are read.
    const frequencies = new Float64Array(height);
    for (let row = 0; row < height; row += 1) {
      frequencies[height - 1 - row] = frequencyAt(lane, (top + row + 0.5) / ratio, axis);
    }
    const weights = new MaskWeights(mask);
    const column = new Float64Array(height);
    const values = new Uint8Array(width * height);
    for (let index = 0; index < width; index += 1) {
      const centre = (left + index + 0.5) / ratio;
      weights.row(viewport.start + (centre - origin) / perSample, frequencies, column);
      for (let row = 0; row < height; row += 1) {
        values[row * width + index] = Math.round((column[height - 1 - row] ?? 0) * 255);
      }
    }
    this.#made += 1;
    return {
      kind: 'field',
      field: { key: `spectral-mask-weight:${String(this.#made)}`, width, height, values },
      at: { x: left / ratio, y: top / ratio, width: width / ratio, height: height / ratio },
      columns: { from: 0, to: width },
      rows: Float32Array.from({ length: height }, (_, row) => row),
    };
  }
}
