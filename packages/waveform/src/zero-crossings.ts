/**
 * Finding the zero crossing nearest a position, for snapping (REQ-EDIT-013).
 *
 * What a zero crossing is, the engine states once (`isZeroCrossingBoundary`);
 * snapping counts the audio before the first frame and after the last as
 * silence, so the start and end of a source are crossings. The nearest is
 * found by reading outward from the position in widening windows, so a
 * crossing a few samples away costs a few samples to find, and a search reads
 * at most its bounded reach either side.
 */

import { sampleCount, throwIfCancelled, type CancellationSignal } from '@audiogubbins/domain';
import {
  type BoundarySamples,
  ZeroCrossingEdges,
  allocateBlock,
  isZeroCrossingBoundary,
  type PcmSource,
} from '@audiogubbins/audio-engine';

/** The search a view makes for the zero crossing nearest a position. */
export interface ZeroCrossingSearch {
  /**
   * The crossing nearest `position` within `within` frames on `channels`, the
   * earlier of two at equal distance, or `undefined` where there is none.
   */
  nearest(
    position: number,
    within: number,
    channels: readonly number[],
    signal?: CancellationSignal,
  ): Promise<number | undefined>;
}

/** The first reach a search reads either side, widened fourfold until it finds one or reaches `within`. */
const FIRST_REACH = 1024;

/**
 * The furthest a search reads either side: 262,144 frames, over five seconds at
 * 48 kHz. A tolerance wider than that is a view so far out that a pixel holds
 * more than any crossing could be told from, and the reads stay bounded.
 */
const MAXIMUM_REACH = 262_144;

/** Reads frames `[from, to)` of `source`, whose length is `length`. */
async function readFrames(
  source: PcmSource,
  from: number,
  to: number,
  length: number,
  signal?: CancellationSignal,
): Promise<BoundarySamples> {
  const start = sampleCount(from);
  if (!start.ok) throw new RangeError(`Frame ${String(from)} is not a position to read from.`);
  const block = allocateBlock(source.layout, source.sampleRate, Math.max(1, to - from));
  const read = await source.read(start.value, block, signal);
  return { channels: block.channels.map((channel) => channel.subarray(0, read)), from, length };
}

/** The crossing nearest `position` within `within` frames of `source`, on `channels`. */
export async function nearestZeroCrossing(
  source: PcmSource,
  position: number,
  within: number,
  channels: readonly number[],
  signal?: CancellationSignal,
): Promise<number | undefined> {
  const length = source.length ?? Number.MAX_SAFE_INTEGER;
  const reach = Math.min(MAXIMUM_REACH, Math.max(0, Math.floor(within)));
  for (let span = Math.min(FIRST_REACH, reach); ; span = Math.min(span * 4, reach)) {
    throwIfCancelled(signal);
    const from = Math.max(0, position - span - 1);
    const to = Math.min(length, position + span + 1);
    const samples = await readFrames(source, from, to, length, signal);
    for (let distance = 0; distance <= span; distance += 1) {
      for (const at of distance === 0 ? [position] : [position - distance, position + distance]) {
        if (isZeroCrossingBoundary(samples, at, channels, ZeroCrossingEdges.Silence)) return at;
      }
    }
    if (span >= reach) return undefined;
  }
}
