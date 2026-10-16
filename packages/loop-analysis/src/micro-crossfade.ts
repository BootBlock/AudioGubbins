/**
 * The shortest crossfade that makes a seam pass (the plan's candidate search,
 * step 7): of 2, 5, 10, 20 and 50 ms, and at least two periods of a dominant
 * partial, each length C with each of the domain's fade shapes is scored over
 * the crossfaded audio, `[E−C−W, E) ∪ [S, S+W)`, as the region's plan would
 * realise it: the last C frames of the loop become its end faded out summed
 * with the C frames before its start faded in, by the domain's gains. A
 * crossfade passes where the discontinuity at the fade's start and at the seam
 * passes, the level change of its shape passes, and the faded audio's spectrum
 * against the audio before S passes. The shortest length that passes is
 * suggested, with its shape that changes the level least.
 */

import { gainAt, type FadeShape } from '@audiogubbins/domain';

import { FADE_SHAPES, fadeCurve, largestLevelChange, spanPair } from './crossfade-suitability.js';
import type { LoopCapture } from './loop-capture.js';
import type { SeamPlace } from './loop-windows.js';
import type { MeasuringKit } from './measuring-kit.js';
import { discontinuityOf, type JoinedStream } from './seam-discontinuity.js';
import { seamFrames } from './seam-residual.js';
import { spectralMismatch } from './spectral-mismatch.js';
import { verdictOf, worstChannel } from './verdicts.js';

/** A crossfade a search suggests. */
export interface SuggestedCrossfade {
  readonly lengthFrames: number;
  readonly shape: FadeShape;
}

/** The lengths a micro-crossfade is tried at, in milliseconds. */
const LENGTHS_MS = [2, 5, 10, 20, 50] as const;

/** The periods of a dominant partial a crossfade spans at least. */
const LEAST_PERIODS = 2;

/** The lengths in frames a seam is tried with at `sampleRate`, shortest first, each at least two periods of `dominantHertz`. */
export function microCrossfadeLengths(
  sampleRate: number,
  dominantHertz: number | undefined,
): readonly number[] {
  const least = dominantHertz === undefined ? 0 : (LEAST_PERIODS * sampleRate) / dominantHertz;
  const lengths: number[] = [];
  for (const milliseconds of LENGTHS_MS) {
    const frames = Math.round((milliseconds * sampleRate) / 1000);
    if (frames >= least && frames > 1 && !lengths.includes(frames)) lengths.push(frames);
  }
  return lengths;
}

/** Whether a crossfade of `length` fits `place`: the audio before S, and the loop with a window to spare. */
export function crossfadeFits(place: SeamPlace, length: number): boolean {
  return length <= place.start && length + place.window <= place.end - place.start;
}

/** Each channel's audio the engine plays across the seam of `place` crossfaded over `length` in `shape`. */
function crossfadedStream(
  capture: LoopCapture,
  place: SeamPlace,
  length: number,
  shape: FadeShape,
  channel: number,
): Float32Array {
  const { start, end, window } = place;
  const stream = new Float32Array(window + length + window);
  stream.set(capture.samples(channel, end - length - window, end - length), 0);
  const out = capture.samples(channel, end - length, end);
  const into = capture.samples(channel, start - length, start);
  const falling = fadeCurve(shape, length, false);
  const rising = fadeCurve(shape, length, true);
  for (let frame = 0; frame < length; frame += 1) {
    stream[window + frame] =
      (out[frame] ?? 0) * gainAt(falling, frame) + (into[frame] ?? 0) * gainAt(rising, frame);
  }
  stream.set(capture.samples(channel, start, start + window), window + length);
  return stream;
}

/** The region's own audio around the seam of `place` with a crossfade of `length`, where it has it. */
function naturalStreams(
  capture: LoopCapture,
  place: SeamPlace,
  length: number,
): readonly JoinedStream[] {
  const { start, end, window, regionLength } = place;
  const channels = Array.from({ length: capture.channels }, (_, channel) => channel);
  const streams: JoinedStream[] = [];
  if (end + window <= regionLength) {
    streams.push({
      reference: 'post-end',
      channels: channels.map((channel) =>
        capture.samples(channel, end - length - window, end + window),
      ),
    });
  }
  if (start - length - window >= 0) {
    streams.push({
      reference: 'pre-start',
      channels: channels.map((channel) =>
        capture.samples(channel, start - length - window, start + window),
      ),
    });
  }
  return streams;
}

/** The shape of a crossfade of `length` over `place` that passes and changes the level least, if one does. */
export function passingShape(
  capture: LoopCapture,
  kit: MeasuringKit,
  place: SeamPlace,
  length: number,
): SuggestedCrossfade | undefined {
  const { start, end, window } = place;
  const channels = Array.from({ length: capture.channels }, (_, channel) => channel);
  const pair = spanPair(
    channels.map((channel) => capture.samples(channel, end - length, end)),
    channels.map((channel) => capture.samples(channel, start - length, start)),
  );
  const naturals = naturalStreams(capture, place, length);
  let chosen: { readonly shape: FadeShape; readonly change: number } | undefined;
  for (const shape of FADE_SHAPES) {
    const change = largestLevelChange(pair, shape);
    if (verdictOf('crossfade', change) !== 'pass') continue;
    if (chosen !== undefined && change >= chosen.change) continue;
    const played = channels.map((channel) =>
      crossfadedStream(capture, place, length, shape, channel),
    );
    const discontinuity = worstChannel(
      'discontinuity',
      discontinuityOf(kit, played, naturals, [
        ...seamFrames(window),
        ...seamFrames(window + length),
      ]),
    );
    if (discontinuity.verdict !== 'pass') continue;
    if (start >= window) {
      const spectral = worstChannel(
        'spectralMismatch',
        played.map((stream, channel) => {
          const mismatch = spectralMismatch(
            kit,
            stream.subarray(length, length + window),
            capture.samples(channel, start - window, start),
          );
          return mismatch === undefined
            ? { notApplicable: 'No band to compare.' }
            : { value: mismatch };
        }),
      );
      if (spectral.verdict === 'warn' || spectral.verdict === 'fail') continue;
    }
    chosen = { shape, change };
  }
  return chosen === undefined ? undefined : { lengthFrames: length, shape: chosen.shape };
}

/** The shortest of `lengths` whose crossfade over `place` passes, with its shape, if one does. */
export function suggestCrossfade(
  capture: LoopCapture,
  kit: MeasuringKit,
  place: SeamPlace,
  lengths: readonly number[],
): SuggestedCrossfade | undefined {
  for (const length of lengths) {
    if (!crossfadeFits(place, length)) continue;
    const suggested = passingShape(capture, kit, place, length);
    if (suggested !== undefined) return suggested;
  }
  return undefined;
}
