/**
 * The W-frame windows either side of a pair's seam, read from what the pass
 * kept: the tail the engine plays before it jumps, the head it plays after,
 * and the audio the region has after E and before S. A loop under 256
 * frames is read around itself, so its tail and head are the loop repeated.
 */

import type { LoopCapture } from './loop-capture.js';
import { isCyclic, type SeamPlace } from './loop-windows.js';
import type { SeamReference } from './verdicts.js';

/** One channel's windows around a seam. */
export interface SeamWindows {
  /** The W frames the engine plays before the seam. */
  readonly tail: Float32Array;
  /** The W frames it plays after the seam. */
  readonly head: Float32Array;
  /** x[S−W, S), where the region has it. */
  readonly preStart: Float32Array | undefined;
  /** x[E, E+W), where the region has it. */
  readonly postEnd: Float32Array | undefined;
  /**
   * What the reference compares: what the engine plays, what should be there,
   * and how many frames the second starts after the first in what is played.
   */
  readonly compared: readonly [Float32Array, Float32Array, number];
}

/**
 * `count` frames of the loop `[start, start + length)` read around itself
 * from loop frame `offset`. Within one cycle they are at most two runs, one
 * ending at E and one starting at S, each kept around its boundary; more than
 * a cycle is only asked of a loop shorter than the margin kept, which is kept
 * whole.
 */
export function cyclicFrames(
  capture: LoopCapture,
  channel: number,
  start: number,
  length: number,
  offset: number,
  count: number,
): Float32Array {
  const frames = new Float32Array(count);
  const first = ((offset % length) + length) % length;
  if (count > length) {
    const loop = capture.samples(channel, start, start + length);
    for (let index = 0; index < count; index += 1)
      frames[index] = loop[(first + index) % length] ?? 0;
    return frames;
  }
  const beforeWrap = Math.min(count, length - first);
  frames.set(capture.samples(channel, start + first, start + first + beforeWrap), 0);
  if (beforeWrap < count)
    frames.set(capture.samples(channel, start, start + count - beforeWrap), beforeWrap);
  return frames;
}

/** The windows of `channel` around the seam of `place`, compared by `reference`. */
export function seamWindows(
  capture: LoopCapture,
  place: SeamPlace,
  reference: SeamReference,
  channel: number,
): SeamWindows {
  const { start, end, window, regionLength } = place;
  const length = end - start;
  const cyclic = isCyclic(length);
  const tail = cyclic
    ? cyclicFrames(capture, channel, start, length, -window, window)
    : capture.samples(channel, end - window, end);
  const head = cyclic
    ? cyclicFrames(capture, channel, start, length, 0, window)
    : capture.samples(channel, start, start + window);
  const preStart =
    !cyclic && start >= window ? capture.samples(channel, start - window, start) : undefined;
  const postEnd =
    !cyclic && end + window <= regionLength
      ? capture.samples(channel, end, end + window)
      : undefined;
  const compared: readonly [Float32Array, Float32Array, number] =
    reference === 'post-end' && postEnd !== undefined
      ? [head, postEnd, 0]
      : reference === 'pre-start' && preStart !== undefined
        ? [tail, preStart, 0]
        : [tail, head, window];
  return { tail, head, preStart, postEnd, compared };
}
