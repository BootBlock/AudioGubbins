/**
 * The pairs of boundaries a search measures (the plan's candidate search,
 * steps 1, 3 and 4), at most 512, found from what the pass kept.
 *
 * Starts S′ lie within R of S and ends E′ within R of E, inside the region,
 * at least 256 frames apart. Without the length kept, the start anchors are
 * each channel's sign changes, the 64 nearest S (the 64 nearest frames where
 * no channel changes sign), and each anchor's best 8 ends by the multichannel
 * normalised cross-correlation of its neighbourhood, w = min(256, W) frames
 * either side, over the end window (`end-correlation.ts`). With the length kept, every start is scored at E′ = S′ + L, the
 * numerator a running sum of products, and the best 512 kept.
 *
 * Audio outside the region is left out of every sum: it reads as zero.
 */

import { ZeroCrossingEdges, isZeroCrossingBoundary } from '@audiogubbins/audio-engine';

import { EndCorrelator, framesOf, normalised, prefixSums, squaresOver } from './end-correlation.js';
import type { LoopCapture } from './loop-capture.js';
import { SHORTEST_UNWRAPPED_LOOP } from './loop-windows.js';
import type { MeasuringKit } from './measuring-kit.js';

/** Where a search looks. */
export interface SearchBounds {
  readonly start: number;
  readonly end: number;
  readonly regionLength: number;
  readonly radius: number;
  readonly keepLength: boolean;
  /** The analysis window W. */
  readonly window: number;
}

/** A pair of boundaries, in region frames. */
export interface BoundaryPair {
  readonly start: number;
  readonly end: number;
}

/** The most start anchors a search correlates. */
const MOST_ANCHORS = 64;

/** The ends kept for each anchor. */
const ENDS_PER_ANCHOR = 8;

/** The most pairs a search measures. */
export const MOST_PAIRS = 512;

/** The frames either side of a boundary its neighbourhood spans, at most. */
const NEIGHBOURHOOD = 256;

/** The neighbourhood half-width for window `window`. */
function neighbourhood(window: number): number {
  return Math.min(NEIGHBOURHOOD, window);
}

/** The starts a search may take: within R of S, in the region, room left for a loop of 256 frames. */
function startRange(bounds: SearchBounds): readonly [number, number] {
  return [
    Math.max(0, bounds.start - bounds.radius),
    Math.min(bounds.start + bounds.radius, bounds.regionLength - SHORTEST_UNWRAPPED_LOOP),
  ];
}

/** The ends a search may take: within R of E, in the region. */
function endRange(bounds: SearchBounds): readonly [number, number] {
  return [
    Math.max(1, bounds.end - bounds.radius),
    Math.min(bounds.end + bounds.radius, bounds.regionLength),
  ];
}

/** The 64 starts nearest S where some channel changes sign, or the 64 nearest where none does. */
export function startAnchors(capture: LoopCapture, bounds: SearchBounds): readonly number[] {
  const [first, last] = startRange(bounds);
  if (last < first) return [];
  const from = Math.max(0, first - 1);
  const samples = {
    channels: Array.from({ length: capture.channels }, (_, channel) =>
      capture.samples(channel, from, Math.min(capture.regionLength, last + 1)),
    ),
    from,
    length: capture.regionLength,
  };
  const nearest = (frames: number[]): readonly number[] =>
    frames
      .sort((a, b) => Math.abs(a - bounds.start) - Math.abs(b - bounds.start) || a - b)
      .slice(0, MOST_ANCHORS);
  const crossings: number[] = [];
  const every: number[] = [];
  for (let frame = first; frame <= last; frame += 1) {
    every.push(frame);
    for (let channel = 0; channel < capture.channels; channel += 1) {
      if (isZeroCrossingBoundary(samples, frame, [channel], ZeroCrossingEdges.Interior)) {
        crossings.push(frame);
        break;
      }
    }
  }
  return nearest(crossings.length > 0 ? crossings : every);
}

/** The best `count` of `scored`, by correlation, then nearer `target`, then earlier. */
function best(
  scored: readonly { readonly frame: number; readonly score: number }[],
  target: number,
  count: number,
): readonly number[] {
  return [...scored]
    .sort(
      (a, b) =>
        b.score - a.score ||
        Math.abs(a.frame - target) - Math.abs(b.frame - target) ||
        a.frame - b.frame,
    )
    .slice(0, count)
    .map(({ frame }) => frame);
}

/** Keeps the best `count` frames offered: by score, then nearer `target`, then earlier. */
class BestFrames {
  readonly #count: number;
  readonly #target: number;
  readonly #kept: { readonly frame: number; readonly score: number }[] = [];

  constructor(count: number, target: number) {
    this.#count = count;
    this.#target = target;
  }

  /** Whether `a` ranks before `b`. */
  #before(
    a: { readonly frame: number; readonly score: number },
    b: { readonly frame: number; readonly score: number },
  ): boolean {
    if (a.score !== b.score) return a.score > b.score;
    const nearer = Math.abs(a.frame - this.#target) - Math.abs(b.frame - this.#target);
    return nearer !== 0 ? nearer < 0 : a.frame < b.frame;
  }

  offer(frame: number, score: number): void {
    const entry = { frame, score };
    const kept = this.#kept;
    let at = kept.length;
    while (at > 0 && this.#before(entry, kept[at - 1] ?? entry)) at -= 1;
    if (at >= this.#count) return;
    kept.splice(at, 0, entry);
    if (kept.length > this.#count) kept.pop();
  }

  get frames(): readonly number[] {
    return this.#kept.map(({ frame }) => frame);
  }
}

/** Each anchor's best 8 ends by the normalised cross-correlation of its neighbourhood over the end window. */
export function correlatedPairs(
  capture: LoopCapture,
  kit: MeasuringKit,
  bounds: SearchBounds,
  anchors: readonly number[],
): readonly BoundaryPair[] {
  const [firstEnd, lastEnd] = endRange(bounds);
  const correlator = new EndCorrelator(
    capture,
    kit,
    firstEnd,
    lastEnd,
    neighbourhood(bounds.window),
  );
  if (anchors.length === 0 || correlator.ends === 0) return [];
  const scores = new Float64Array(correlator.ends);
  const pairs: BoundaryPair[] = [];
  for (const anchor of anchors) {
    correlator.scores(anchor, scores);
    const best = new BestFrames(ENDS_PER_ANCHOR, bounds.end);
    scores.forEach((score, output) => {
      const end = correlator.firstEnd + output;
      if (end - anchor >= SHORTEST_UNWRAPPED_LOOP) best.offer(end, score);
    });
    for (const end of best.frames) pairs.push({ start: anchor, end });
  }
  return pairs;
}

/** With the length kept: every start scored at E′ = S′ + L, the best 512. */
export function keptLengthPairs(
  capture: LoopCapture,
  bounds: SearchBounds,
): readonly BoundaryPair[] {
  const length = bounds.end - bounds.start;
  const [first, lastStart] = startRange(bounds);
  const last = Math.min(lastStart, bounds.regionLength - length);
  if (length < SHORTEST_UNWRAPPED_LOOP || last < first) return [];
  const half = neighbourhood(bounds.window);
  const from = first - half;
  const frames = last + half - from;
  const starts = Array.from({ length: capture.channels }, (_, channel) =>
    framesOf(capture, channel, from, from + frames),
  );
  const ends = Array.from({ length: capture.channels }, (_, channel) =>
    framesOf(capture, channel, from + length, from + length + frames),
  );
  const products = new Float64Array(frames);
  starts.forEach((samples, channel) => {
    const other = ends[channel];
    for (let frame = 0; frame < frames; frame += 1) {
      products[frame] = (products[frame] ?? 0) + (samples[frame] ?? 0) * (other?.[frame] ?? 0);
    }
  });
  const numerators = prefixSums(products);
  const startEnergies = prefixSums(squaresOver(starts, frames));
  const endEnergies = prefixSums(squaresOver(ends, frames));
  const scored: { frame: number; score: number }[] = [];
  for (let start = first; start <= last; start += 1) {
    const lo = start - half - from;
    const hi = lo + 2 * half;
    scored.push({
      frame: start,
      score: normalised(
        (numerators[hi] ?? 0) - (numerators[lo] ?? 0),
        (startEnergies[hi] ?? 0) - (startEnergies[lo] ?? 0),
        (endEnergies[hi] ?? 0) - (endEnergies[lo] ?? 0),
      ),
    });
  }
  return best(scored, bounds.start, MOST_PAIRS).map((start) => ({ start, end: start + length }));
}
