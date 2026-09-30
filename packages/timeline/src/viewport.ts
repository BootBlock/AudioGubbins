/**
 * What an editor view shows of the timeline, and the exact conversions between
 * its CSS pixels and sample boundaries.
 *
 * A boundary is the edge between two samples: boundary `n` is where sample `n`
 * starts, so a selection from boundary 10 to boundary 12 holds samples 10 and
 * 11. The viewport's left edge is a boundary, and, where a sample is wider than
 *     a pixel, a whole number of pixels into the sample that starts there.
 *     Every conversion is integer arithmetic from that edge and the zoom, done
 *     afresh each time, so nothing accumulates: a scroll and its reverse cancel
 *     exactly, and a zoom keeps the boundary under its anchor exactly
 *     (ADR-0041).
 */

import type { SampleCount } from '@audiogubbins/domain';

import { samplesInPixel, zoomFitting, type Zoom } from './zoom.js';

/** What an editor view shows of the timeline. */
export interface ViewportState {
  /** The boundary at the left edge, or the sample whose column the edge falls in. */
  readonly start: SampleCount;
  /**
   * Whole CSS pixels from `start` to the left edge, below the zoom's pixels per
   * sample, and zero at a zoom of samples per pixel.
   */
  readonly offset: number;
  readonly zoom: Zoom;
  /** The view's width in CSS pixels, which a layout may give as a fraction. */
  readonly width: number;
}

/** A half-open run of boundaries, `[start, end)`. */
export interface BoundaryRange {
  readonly start: SampleCount;
  readonly end: SampleCount;
}

/**
 * Mints a boundary from arithmetic this module has kept whole and in range. The
 * domain's `sampleCount` validates a value from outside; a position this module
 * computed is clamped to `[0, length]` first, so it is one already.
 */
function boundary(value: number): SampleCount {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- a whole, clamped, non-negative position is a boundary
  return value as SampleCount;
}

/** Rounds half away from zero, so a distance and its negation round to negations. */
export function roundHalfAway(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/** `x` times `samples`, rounded half away from zero, exact while the product is below 2^51. */
function scaledRound(x: number, samples: number): number {
  const whole = Math.trunc(x);
  return whole * samples + roundHalfAway((x - whole) * samples);
}

/** `x` times `samples`, rounded down. */
function scaledFloor(x: number, samples: number): number {
  const whole = Math.floor(x);
  return whole * samples + Math.floor((x - whole) * samples);
}

function clampedTo(value: number, length: number): SampleCount {
  return boundary(Math.min(length, Math.max(0, value)));
}

/** A viewport whose left edge is boundary zero. */
export function viewportAtStart(zoom: Zoom, width: number): ViewportState {
  return { start: boundary(0), offset: 0, zoom, width };
}

/** The viewport that shows every sample of `length` in `width` pixels. */
export function viewportFitting(length: SampleCount, width: number): ViewportState {
  return viewportAtStart(zoomFitting(length, width), width);
}

/**
 * The boundary nearest to CSS pixel `x`, unclamped: a pixel left of the view or
 * past the end gives a boundary outside the timeline, for the caller to clamp
 * to what it holds.
 */
export function nearestBoundary(view: ViewportState, x: number): number {
  return view.zoom.kind === 'samples-per-pixel'
    ? view.start + scaledRound(x, view.zoom.samples)
    : view.start + roundHalfAway((x + view.offset) / view.zoom.pixels);
}

/** The boundary nearest to CSS pixel `x`, within `[0, length]`. */
export function boundaryAt(view: ViewportState, x: number, length: SampleCount): SampleCount {
  return clampedTo(nearestBoundary(view, x), length);
}

/**
 * The sample CSS pixel `x` falls on, within `[0, length)`, or `undefined` for
 * an empty timeline. At a zoom of samples per pixel it is the first sample of
 * the pixel's column.
 */
export function sampleAt(
  view: ViewportState,
  x: number,
  length: SampleCount,
): SampleCount | undefined {
  if (length <= 0) return undefined;
  const sample =
    view.zoom.kind === 'samples-per-pixel'
      ? view.start + scaledFloor(x, view.zoom.samples)
      : view.start + Math.floor((x + view.offset) / view.zoom.pixels);
  return clampedTo(sample, length - 1);
}

/** The CSS pixel boundary `position` falls at, which may be outside the view. */
export function pixelOf(view: ViewportState, position: number): number {
  return view.zoom.kind === 'samples-per-pixel'
    ? (position - view.start) / view.zoom.samples
    : (position - view.start) * view.zoom.pixels - view.offset;
}

/** The boundaries the view shows any part of, within `[0, length]`. */
export function visibleRange(view: ViewportState, length: SampleCount): BoundaryRange {
  const start = clampedTo(view.start, length);
  const columns = Math.ceil(view.width);
  const end =
    view.zoom.kind === 'samples-per-pixel'
      ? view.start + columns * view.zoom.samples
      : view.start + Math.ceil((columns + view.offset) / view.zoom.pixels);
  return { start, end: clampedTo(end, length) };
}

/**
 * The left edge placed `pixels` pixels into boundary `at`'s sample, with a
 * negative distance borrowing from the samples before it.
 */
function edgeAt(view: ViewportState, at: number, pixels: number): ViewportState {
  if (view.zoom.kind === 'samples-per-pixel') return { ...view, start: boundary(at), offset: 0 };
  const perSample = view.zoom.pixels;
  const carry = Math.floor(pixels / perSample);
  return { ...view, start: boundary(at + carry), offset: pixels - carry * perSample };
}

/**
 * The furthest left edge that still has the timeline's end at or beyond the
 * right edge, or boundary zero where the whole timeline fits.
 */
function lastEdge(view: ViewportState, length: SampleCount): ViewportState {
  const columns = Math.ceil(view.width);
  if (view.zoom.kind === 'samples-per-pixel') {
    return {
      ...view,
      start: boundary(Math.max(0, length - columns * view.zoom.samples)),
      offset: 0,
    };
  }
  const last = edgeAt(view, length, -columns);
  return last.start < 0 ? { ...view, start: boundary(0), offset: 0 } : last;
}

function isBefore(left: ViewportState, right: ViewportState): boolean {
  return left.start < right.start || (left.start === right.start && left.offset < right.offset);
}

/** `view` with its left edge kept between the timeline's start and {@link lastEdge}. */
export function clampedView(view: ViewportState, length: SampleCount): ViewportState {
  if (view.start < 0 || (view.start === 0 && view.offset < 0)) {
    return { ...view, start: boundary(0), offset: 0 };
  }
  const last = lastEdge(view, length);
  return isBefore(last, view) ? last : view;
}

/**
 * `view` scrolled by `dx` CSS pixels, positive towards the end. The distance is
 * turned into whole samples, or whole pixels within a sample, afresh, so the
 * same scroll back returns the same edge wherever the view is.
 */
export function scrolledBy(view: ViewportState, dx: number, length: SampleCount): ViewportState {
  if (!Number.isFinite(dx) || dx === 0) return view;
  const moved =
    view.zoom.kind === 'samples-per-pixel'
      ? { ...view, start: boundary(view.start + scaledRound(dx, view.zoom.samples)) }
      : edgeAt(view, view.start, view.offset + roundHalfAway(dx));
  return clampedView(moved, length);
}

/** `view` with boundary `position` at CSS pixel `x`, clamped to the timeline. */
export function placedAt(
  view: ViewportState,
  position: SampleCount,
  x: number,
  length: SampleCount,
): ViewportState {
  const placed =
    view.zoom.kind === 'samples-per-pixel'
      ? { ...view, start: boundary(position - scaledRound(x, view.zoom.samples)), offset: 0 }
      : edgeAt(view, position, -roundHalfAway(x));
  return clampedView(placed, length);
}

/** `view` with `position` in the middle of it. */
export function centredOn(
  view: ViewportState,
  position: SampleCount,
  length: SampleCount,
): ViewportState {
  return placedAt(view, position, view.width / 2, length);
}

/**
 * `view` at `zoom`, with the boundary nearest CSS pixel `anchorX` kept under
 * it, which a clamp at either end of the timeline may move.
 */
export function zoomedAround(
  view: ViewportState,
  zoom: Zoom,
  anchorX: number,
  length: SampleCount,
): ViewportState {
  const anchor = clampedTo(nearestBoundary(view, anchorX), length);
  return placedAt({ ...view, zoom, offset: 0 }, anchor, anchorX, length);
}

/** `view` at a new width, its left edge kept. */
export function resized(view: ViewportState, width: number, length: SampleCount): ViewportState {
  return width === view.width ? view : clampedView({ ...view, width }, length);
}

/**
 * The view that shows `range` with `margin` CSS pixels either side of it, at
 * the finest zoom that fits it, centred.
 */
export function framing(
  view: ViewportState,
  range: BoundaryRange,
  margin: number,
  length: SampleCount,
): ViewportState {
  const usable = Math.max(1, view.width - 2 * margin);
  const zoom = zoomFitting(Math.max(1, range.end - range.start), usable);
  const middle = boundary(range.start + Math.floor((range.end - range.start) / 2));
  return placedAt({ ...view, zoom, offset: 0 }, middle, view.width / 2, length);
}

/** Samples within `pixels` CSS pixels at the view's zoom, at least one. */
export function samplesWithin(view: ViewportState, pixels: number): number {
  return Math.max(1, Math.ceil(pixels * samplesInPixel(view.zoom)));
}
