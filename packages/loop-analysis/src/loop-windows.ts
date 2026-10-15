/**
 * The windows a loop's seam is measured over (ADR-0103, the plan's "Windows
 * and references").
 *
 * S is the loop's start and E the first frame after it, L = E − S, in a region
 * of N frames. The analysis window W is 50 ms, between 256 and 32,768 frames,
 * and at most a quarter of a loop of 256 frames or more. A loop under 256
 * frames is read around itself, cyclically, since what an engine plays of it
 * is the loop repeated. A seam metric compares what an engine plays after E
 * with what should follow it, by the first reference the region has the audio
 * for: `post-end`, the head x[S, S+W) against x[E, E+W); `pre-start`, the
 * tail x[E−W, E) against x[S−W, S); `adjacent`, the tail against the head.
 */

import type { SampleRate } from '@audiogubbins/domain';

import type { SeamReference } from './verdicts.js';

/** The fewest frames a loop is read without wrapping, and the fewest the window holds. */
export const SHORTEST_UNWRAPPED_LOOP = 256;

/** The most frames the window holds: above 655 kHz the 50 ms window is shortened to it. */
const LONGEST_WINDOW = 32_768;

/** The window W for a loop of `length` frames at `sampleRate`. */
export function analysisWindow(sampleRate: SampleRate, length: number): number {
  const window = Math.min(
    LONGEST_WINDOW,
    Math.max(SHORTEST_UNWRAPPED_LOOP, Math.round(0.05 * sampleRate)),
  );
  return length >= SHORTEST_UNWRAPPED_LOOP ? Math.min(window, Math.floor(length / 4)) : window;
}

/** One 10 ms step of the loop's dB envelope, in frames. */
export function envelopeCellFrames(sampleRate: SampleRate): number {
  return Math.max(1, Math.round(0.01 * sampleRate));
}

/** The frames either side of the seam its envelope reading spans: 5 ms. */
export function seamEnvelopeFrames(sampleRate: SampleRate): number {
  return Math.max(1, Math.round(0.005 * sampleRate));
}

/** The span a DC mean is weighted over at most: the window, or 200 ms where that is longer. */
export function dcSpanFrames(sampleRate: SampleRate, window: number): number {
  return Math.max(window, Math.round(0.2 * sampleRate));
}

/** The longest micro-crossfade a search suggests: 50 ms. */
export function longestMicroCrossfade(sampleRate: SampleRate): number {
  return Math.round(0.05 * sampleRate);
}

/**
 * The audio a pair's measurement reads either side of each boundary: its DC
 * span, or the longest micro-crossfade and a window before it, whichever is
 * longer.
 */
export function measuringMargin(sampleRate: SampleRate, window: number): number {
  return Math.max(dcSpanFrames(sampleRate, window), longestMicroCrossfade(sampleRate) + window);
}

/** Where a pair of boundaries lies, and the window it is measured with. */
export interface SeamPlace {
  readonly start: number;
  readonly end: number;
  readonly regionLength: number;
  readonly window: number;
}

/** Whether a loop of `length` frames is read around itself. */
export function isCyclic(length: number): boolean {
  return length < SHORTEST_UNWRAPPED_LOOP;
}

/** The references the region has the audio for, in the order a seam metric prefers them. */
function availableReferences(place: SeamPlace): readonly SeamReference[] {
  const { start, end, regionLength, window } = place;
  if (isCyclic(end - start)) return ['adjacent'];
  const references: SeamReference[] = [];
  if (end + window <= regionLength) references.push('post-end');
  if (start - window >= 0) references.push('pre-start');
  references.push('adjacent');
  return references;
}

/** The reference a seam metric uses: the first the region has the audio for. */
export function seamReference(place: SeamPlace): SeamReference {
  return availableReferences(place)[0] ?? 'adjacent';
}
