/**
 * Finding the zero crossing nearest a position, for snapping (REQ-EDIT-013).
 *
 * A zero crossing is a boundary at which every channel asked for changes sign,
 * or has a sample of exactly zero on either side, so a cut there starts and
 * ends every channel at silence; a crossing on some channels and not others is
 * not one, since a cut there would click on the others. The audio before the
 * first frame and after the last counts as silence, so the start and end of a
 * source are crossings. The nearest is found by reading outward from the
 * position in widening windows, so a crossing a few samples away costs a few
 * samples to find, and a search reads at most its bounded reach either side.
 */

import { sampleCount } from '@audiogubbins/domain';
import {
  allocateBlock,
  throwIfCancelled,
  type CancellationSignal,
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

/** Whether boundary `at` of `samples`, which start at frame `from`, is a crossing on every channel. */
function crosses(
  samples: readonly Float32Array[],
  from: number,
  at: number,
  length: number,
): boolean {
  return samples.every((channel) => {
    const before = at - 1 < 0 ? 0 : (channel[at - 1 - from] ?? 0);
    const after = at >= length ? 0 : (channel[at - from] ?? 0);
    return before * after <= 0;
  });
}

/** Reads frames `[from, to)` of `channels` of `source`. */
async function readFrames(
  source: PcmSource,
  from: number,
  to: number,
  channels: readonly number[],
  signal?: CancellationSignal,
): Promise<readonly Float32Array[]> {
  const start = sampleCount(from);
  if (!start.ok) throw new RangeError(`Frame ${String(from)} is not a position to read from.`);
  const block = allocateBlock(source.layout, source.sampleRate, Math.max(1, to - from));
  const read = await source.read(start.value, block, signal);
  return channels.map((channel) =>
    (block.channels[channel] ?? new Float32Array(0)).subarray(0, read),
  );
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
    const samples = await readFrames(source, from, to, channels, signal);
    for (let distance = 0; distance <= span; distance += 1) {
      for (const at of distance === 0 ? [position] : [position - distance, position + distance]) {
        if (at >= 0 && at <= length && crosses(samples, from, at, length)) return at;
      }
    }
    if (span >= reach) return undefined;
  }
}
