/**
 * What a region with a looping crossfade sounds like, stated sample by sample
 * from what it sounds like without one (ADR-0103), for a property test to hold
 * the plan to.
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
