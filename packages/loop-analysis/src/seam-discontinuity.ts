/**
 * The discontinuity of a seam: how far the residual at the seam of what the
 * engine plays, the tail then the head, stands out of that stream, beyond how
 * far it stands out where the region's own audio is joined.
 *
 * A seam is compared with what should be there, as every seam metric is
 * (ADR-0103): the tail then the audio after E, and the audio before S then the
 * head, where the region has them. Whichever natural join stands out less is
 * subtracted, so a drum loop whose head is a hit after its decay is not a
 * discontinuity where the region's own audio hits there too, while a click on
 * either side of the seam, which only one of the two natural joins also has,
 * still is. A loop with neither, a whole-sound loop, is measured on the played
 * stream alone.
 */

import type { SeamPlace } from './loop-windows.js';
import type { MeasuringKit } from './measuring-kit.js';
import { seamDeviations, seamFrames } from './seam-residual.js';
import type { SeamWindows } from './seam-windows.js';
import type { ChannelReading, SeamReference } from './verdicts.js';

/** A stream, one array per channel, and what it is. */
export interface JoinedStream {
  readonly reference: SeamReference;
  readonly channels: readonly Float32Array[];
}

/** `first` then `second`, as one array. */
function joined(first: Float32Array, second: Float32Array): Float32Array {
  const stream = new Float32Array(first.length + second.length);
  stream.set(first, 0);
  stream.set(second, first.length);
  return stream;
}

/**
 * Each channel's discontinuity: the played stream's deviation at `seamFrames`,
 * less the smaller of the natural joins' at the same frames.
 */
export function discontinuityOf(
  kit: MeasuringKit,
  played: readonly Float32Array[],
  naturals: readonly JoinedStream[],
  seamFrames: readonly number[],
): readonly ChannelReading[] {
  const heard = seamDeviations(kit, played, seamFrames);
  const natural = naturals.map((stream) => ({
    reference: stream.reference,
    deviations: seamDeviations(kit, stream.channels, seamFrames),
  }));
  return played.map((_, channel): ChannelReading => {
    let least: { readonly reference: SeamReference; readonly deviation: number } | undefined;
    for (const { reference, deviations } of natural) {
      const deviation = deviations[channel] ?? 0;
      if (least === undefined || deviation < least.deviation) least = { reference, deviation };
    }
    const played = heard[channel] ?? 0;
    return least === undefined
      ? { value: played, reference: 'adjacent' }
      : { value: Math.max(0, played - least.deviation), reference: least.reference };
  });
}

/** The natural joins the region has around a seam, `post-end` first. */
function naturalJoins(
  windows: readonly SeamWindows[],
  joinAfterEnd: (window: SeamWindows) => Float32Array | undefined,
  joinBeforeStart: (window: SeamWindows) => Float32Array | undefined,
): readonly JoinedStream[] {
  const streams: JoinedStream[] = [];
  const afterEnd = windows.map(joinAfterEnd);
  if (afterEnd.every((stream) => stream !== undefined)) {
    streams.push({
      reference: 'post-end',
      channels: afterEnd,
    });
  }
  const beforeStart = windows.map(joinBeforeStart);
  if (beforeStart.every((stream) => stream !== undefined)) {
    streams.push({
      reference: 'pre-start',
      channels: beforeStart,
    });
  }
  return streams;
}

/** Each channel's discontinuity at the seam of `place`, whose windows are `windows`. */
export function seamDiscontinuity(
  kit: MeasuringKit,
  place: SeamPlace,
  windows: readonly SeamWindows[],
): readonly ChannelReading[] {
  const played = windows.map(({ tail, head }) => joined(tail, head));
  const naturals = naturalJoins(
    windows,
    ({ tail, postEnd }) => (postEnd === undefined ? undefined : joined(tail, postEnd)),
    ({ preStart, head }) => (preStart === undefined ? undefined : joined(preStart, head)),
  );
  return discontinuityOf(kit, played, naturals, seamFrames(place.window));
}
