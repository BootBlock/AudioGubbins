/**
 * What a looping region sounds like, stated sample by sample, for a property
 * test to hold the plan to: its racks run from its start (ADR-0060) or wrapped
 * across its loop (ADR-0107), from its asset's audio before the racks, and its
 * crossfade, from what it sounds like without one (ADR-0103).
 *
 * The racks are given as functions, as the edit oracle's chains are: the
 * oracle states what each rack is run over and from where, not what it does.
 * The wrapped region repeats the loop's body by concatenating arrays, with
 * nothing of the plan's streams, so a fault in where the plan reads either run
 * from shows.
 *
 * Each crossfaded frame is the side faded out times its gain, rounded to single
 * precision as a stage rounds it, plus the side faded in likewise, the sum
 * rounded as a mix rounds it. The gains are the domain's fade (`gainAt`): the
 * oracle states where the joins are and what each reads, not the fade.
 */

import { gainAt, type FadeCurve } from '../editing/plan.js';
import type { LoopDefinition } from '../project/timeline.js';
import type { Samples } from './edit-oracle.js';

/** A fade over `length` frames from frame 0, `rising` or falling, in `shape`. */
function fadeOver(length: number, shape: FadeCurve['shape'], rising: boolean): FadeCurve {
  return { kind: 'fade', origin: 0, step: 1, length, shape, rising };
}

/**
 * `plain`, a region's sound without its loop's crossfade, with `loop`'s
 * crossfade, which is placed, so it fits the frames before the loop's start.
 */
export function loopCrossfaded(plain: Samples, loop: LoopDefinition): Samples {
  const { loopStart: start, loopEnd: end, crossfadeLength: fade, crossfadeShape: shape } = loop;
  return plain.map((channel) => {
    const heard = Float32Array.from(channel);
    const join = (at: number, out: number, into: number, length: number): void => {
      const falling = fadeOver(length, shape, false);
      const rising = fadeOver(length, shape, true);
      for (let k = 0; k < length; k += 1) {
        const leaving = Math.fround((channel[out + k] ?? 0) * gainAt(falling, k));
        const arriving = Math.fround((channel[into + k] ?? 0) * gainAt(rising, k));
        heard[at + k] = Math.fround(leaving + arriving);
      }
    };
    if (fade === 0) return heard;
    // At the loop's end: its last frames out, the frames before its start in.
    join(end - fade, end - fade, start - fade, fade);
    // After it, where the region goes on: the frames after its start out, its own in.
    join(end, start, end, Math.min(fade, channel.length - end));
    return heard;
  });
}

/** What the racks upstream of a loop make of audio, each the same length; absent where there is none. */
export interface LoopRacks {
  readonly asset?: (samples: Samples) => Samples;
  readonly region?: (samples: Samples) => Samples;
}

/** The frames `[start, end)` of each channel. */
function span(samples: Samples, start: number, end: number): Samples {
  return samples.map((channel) => channel.slice(start, end));
}

/** `parts` one after another, channel by channel. */
function joined(parts: readonly Samples[]): Samples {
  const channels = parts[0]?.length ?? 0;
  return Array.from({ length: channels }, (_, channel) => {
    const length = parts.reduce((total, part) => total + (part[channel]?.length ?? 0), 0);
    const out = new Float32Array(length);
    let at = 0;
    for (const part of parts) {
      const one = part[channel] ?? new Float32Array(0);
      out.set(one, at);
      at += one.length;
    }
    return out;
  });
}

/**
 * A region's sound before its loop's crossfade, its racks run from its start:
 * `edited`, its asset's audio before the racks, through the asset's rack whole,
 * the region's span `[start, end)` of that, and that through the region's rack.
 */
export function rackedFromStart(
  edited: Samples,
  region: { readonly start: number; readonly end: number },
  racks: LoopRacks,
): Samples {
  const whole = racks.asset?.(edited) ?? edited;
  const cut = span(whole, region.start, region.end);
  return racks.region?.(cut) ?? cut;
}

/**
 * A region's sound before its loop's crossfade, its racks wrapped across
 * `loop` (ADR-0107): the racks run over the loop's body `cycles` times then
 * the region from the loop's start, read from `cycles` bodies on for the loop
 * and after it; the intro the racks run from the region's start, its last
 * `splice` frames that faded out, equal power, summed with the warm-up's last
 * `splice` frames faded in. `loop` is placed, in the region's frames.
 */
export function rackedWrapped(
  edited: Samples,
  region: { readonly start: number; readonly end: number },
  racks: LoopRacks,
  loop: LoopDefinition,
  cycles: number,
  splice: number,
): Samples {
  const { loopStart: start, loopEnd: end } = loop;
  const unracked = span(edited, region.start, region.end);
  const body = span(unracked, start, end);
  const input = joined([
    ...Array.from({ length: cycles }, () => body),
    span(unracked, start, region.end - region.start),
  ]);
  const asset = racks.asset?.(input) ?? input;
  const wrapped = racks.region?.(asset) ?? asset;
  const warmUp = cycles * (end - start);
  const ordinary = rackedFromStart(edited, region, racks);
  const falling = fadeOver(splice, 'equal-power', false);
  const rising = fadeOver(splice, 'equal-power', true);
  return ordinary.map((channel, index) => {
    const run = wrapped[index] ?? new Float32Array(0);
    const heard = new Float32Array(channel.length);
    heard.set(channel.subarray(0, start - splice));
    for (let k = 0; k < splice; k += 1) {
      const leaving = Math.fround((channel[start - splice + k] ?? 0) * gainAt(falling, k));
      const arriving = Math.fround((run[warmUp - splice + k] ?? 0) * gainAt(rising, k));
      heard[start - splice + k] = Math.fround(leaving + arriving);
    }
    heard.set(run.subarray(warmUp), start);
    return heard;
  });
}
