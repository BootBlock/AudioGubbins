/**
 * A spectral selection widened or narrowed from the keyboard (REQ-UX-005,
 * ADR-0082): its span of time or its band moved out, or in, by a step of the
 * view it is seen in, so the keyboard reaches the shapes a pointer draws.
 *
 * The mask is moved as one: its outline's edges go out or in by the step, and
 * every point and edge of every shape, those that take away included, is
 * carried there by the one straight map from the old outline to the new, so
 * each shape keeps its place within the selection. A step in time is a number
 * of the view's CSS pixels; a step in frequency a share of the view's
 * frequency axis, an equal ratio on a logarithmic axis and an equal width on
 * a linear one, so a step looks the same size at any height. A brush's radii
 * and the softness are the tool's, so they are kept as they were.
 */

import {
  derivedSampleCount,
  maskOutline,
  type SampleCount,
  type SpectralMask,
  type SpectralShape,
} from '@audiogubbins/domain';

import { frequencyOfShare, shareOf } from './frequency-axis.js';
import type { SpectralSettings } from './view-state.js';

/** Whether a step takes a selection outward or inward. */
export const SpectralStep = { Widen: 'widen', Narrow: 'narrow' } as const;

/** Whether a step takes a selection outward or inward. */
export type SpectralStep = (typeof SpectralStep)[keyof typeof SpectralStep];

/** How far a step in time moves each edge of a selection, in CSS pixels of the view. */
export const SPECTRAL_TIME_STEP_PIXELS = 10;

/** How far a step in frequency moves each edge of a selection: this share of the axis. */
const FREQUENCY_STEP_SHARE = 1 / 20;

/** A straight map from one span to another. */
function spanMap(
  from: { readonly low: number; readonly high: number },
  to: { readonly low: number; readonly high: number },
): (value: number) => number {
  const scale = (to.high - to.low) / (from.high - from.low);
  return (value) => to.low + (value - from.low) * scale;
}

/** `shape` with each position carried by `time` and each frequency by `frequency`. */
function mappedShape(
  shape: SpectralShape,
  time: (position: number) => number,
  frequency: (hertz: number) => number,
): SpectralShape {
  const at = (position: number): SampleCount => derivedSampleCount(Math.round(time(position)));
  switch (shape.kind) {
    case 'rectangle':
      return {
        ...shape,
        range: { start: at(shape.range.start), end: at(shape.range.end) },
        band: { low: frequency(shape.band.low), high: frequency(shape.band.high) },
      };
    case 'polygon': {
      const point = (one: (typeof shape.points)[number]) => ({
        position: at(one.position),
        frequency: frequency(one.frequency),
      });
      const [a, b, c, ...rest] = shape.points;
      return { ...shape, points: [point(a), point(b), point(c), ...rest.map(point)] };
    }
    case 'stroke': {
      const point = (one: (typeof shape.points)[number]) => ({
        ...one,
        position: at(one.position),
        frequency: frequency(one.frequency),
      });
      const [first, ...rest] = shape.points;
      return { ...shape, points: [point(first), ...rest.map(point)] };
    }
  }
}

function mappedMask(
  mask: SpectralMask,
  time: (position: number) => number,
  frequency: (hertz: number) => number,
): SpectralMask {
  const [first, ...rest] = mask.shapes;
  const shape = (one: SpectralShape) => mappedShape(one, time, frequency);
  return { feather: mask.feather, shapes: [shape(first), ...rest.map(shape)] };
}

const SAME = (value: number): number => value;

/** `map` with what it gives kept from `low` to `high`, where a shape that takes away may reach past. */
function within(map: (value: number) => number, low: number, high: number) {
  return (value: number): number => Math.min(high, Math.max(low, map(value)));
}

/**
 * `mask` with its span of time widened or narrowed by `by` samples at each
 * end, within a timeline of `length`; `undefined` where the step changes
 * nothing, at the timeline's ends, or would leave less than a sample, or
 * where the mask spans no time to stretch.
 */
export function maskSteppedInTime(
  mask: SpectralMask,
  step: SpectralStep,
  by: number,
  length: SampleCount,
): SpectralMask | undefined {
  const { start, end } = maskOutline(mask);
  if (end <= start) return undefined;
  const move = step === SpectralStep.Widen ? by : -by;
  const low = Math.max(0, start - move);
  const high = Math.min(length, end + move);
  if (high - low < 1 || (low === start && high === end)) return undefined;
  return mappedMask(
    mask,
    within(spanMap({ low: start, high: end }, { low, high }), 0, length),
    SAME,
  );
}

/**
 * The band's lower edge moved by `share` of `axis`. On a logarithmic axis a
 * band reaching down to nothing has no ratio to step by: it stays at
 * nothing as it widens, and narrows from the axis's lowest frequency.
 */
function lowEdge(low: number, share: number, axis: SpectralSettings): number {
  if (axis.frequencyScale === 'logarithmic' && low <= 0) {
    return share <= 0 ? 0 : frequencyOfShare(share, axis);
  }
  return Math.max(0, frequencyOfShare(shareOf(low, axis) + share, axis));
}

/**
 * `mask` with its band widened or narrowed by a step of the view's frequency
 * `axis` at each edge, no higher than `highest`; `undefined` where the step
 * changes nothing, at the band's limits, or would leave no band.
 */
export function maskSteppedInFrequency(
  mask: SpectralMask,
  step: SpectralStep,
  axis: SpectralSettings,
  highest: number,
): SpectralMask | undefined {
  const outline = maskOutline(mask);
  if (outline.high <= outline.low) return undefined;
  const share = step === SpectralStep.Widen ? FREQUENCY_STEP_SHARE : -FREQUENCY_STEP_SHARE;
  const low = lowEdge(outline.low, -share, axis);
  const high = Math.min(highest, frequencyOfShare(shareOf(outline.high, axis) + share, axis));
  if (!(high > low) || (low === outline.low && high === outline.high)) return undefined;
  return mappedMask(mask, SAME, within(spanMap(outline, { low, high }), 0, highest));
}
