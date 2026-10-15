/**
 * How well a crossfade suits a seam (the plan's `crossfade` metric): from the
 * audio without the loop's crossfade, the energy-weighted multichannel
 * correlation ρ of the span that fades out, x[E−C, E), and the span that
 * fades in, x[S−C, S); then for each of the domain's fade shapes, with the
 * domain's own gains g_o and g_i at each frame of the fade, the level change
 * `10 · log10((g_o²·A + g_i²·B + 2ρ·g_o·g_i·√(AB)) ÷ ((1 − t)·A + t·B))`
 * against a level moving straight from one span's power A to the other's B.
 * The shape whose largest change is smallest suits it best.
 */

import { log10 } from '@audiogubbins/audio-engine';
import { FadeShape, gainAt, type FadeCurve } from '@audiogubbins/domain';

import { LEAST_DEVIATION } from './seam-residual.js';
import { verdictOf, type Verdict } from './verdicts.js';

/** How a crossfade suits a seam. */
export interface CrossfadeSuitability {
  readonly lengthFrames: number;
  /** Energy-weighted over the channels, from the audio without the crossfade. */
  readonly correlation: number;
  readonly shape: FadeShape;
  /** The largest level change over the fade, for that shape, in dB. */
  readonly levelChangeDb: number;
  readonly verdict: Verdict;
}

/** The domain's fade shapes, in the order a tie between them falls to the earlier. */
export const FADE_SHAPES: readonly FadeShape[] = [
  FadeShape.Linear,
  FadeShape.EqualPower,
  FadeShape.SCurve,
  FadeShape.Square,
];

/** The two spans' powers and their correlation. */
export interface SpanPair {
  readonly frames: number;
  /** The mean square of the span that fades out, over every channel. */
  readonly outPower: number;
  /** The mean square of the span that fades in, over every channel. */
  readonly inPower: number;
  readonly correlation: number;
}

/**
 * The sums a span pair is made from, added a chunk at a time, in channel
 * order and then frame order within each chunk, so a crossfade longer than
 * any one read is measured without holding it.
 */
export class SpanPairSums {
  #frames = 0;
  #channels = 0;
  #product = 0;
  #outEnergy = 0;
  #inEnergy = 0;

  /** Adds `frames` frames of the span fading out and the span fading in, one array per channel each. */
  add(
    fadingOut: readonly (Float32Array | Float64Array)[],
    fadingIn: readonly (Float32Array | Float64Array)[],
    frames: number,
  ): void {
    fadingOut.forEach((out, channel) => {
      const into = fadingIn[channel];
      for (let frame = 0; frame < frames; frame += 1) {
        const a = out[frame] ?? 0;
        const b = into?.[frame] ?? 0;
        this.#product += a * b;
        this.#outEnergy += a * a;
        this.#inEnergy += b * b;
      }
    });
    this.#frames += frames;
    this.#channels = fadingOut.length;
  }

  /** The pair the sums so far describe. */
  pair(): SpanPair {
    const samples = Math.max(1, this.#frames * this.#channels);
    return {
      frames: this.#frames,
      outPower: this.#outEnergy / samples,
      inPower: this.#inEnergy / samples,
      correlation:
        this.#product / Math.max(Math.sqrt(this.#outEnergy * this.#inEnergy), LEAST_DEVIATION),
    };
  }
}

/** The powers and correlation of `fadingOut` and `fadingIn`, one array per channel, of one length. */
export function spanPair(
  fadingOut: readonly (Float32Array | Float64Array)[],
  fadingIn: readonly (Float32Array | Float64Array)[],
): SpanPair {
  const sums = new SpanPairSums();
  sums.add(fadingOut, fadingIn, fadingOut[0]?.length ?? 0);
  return sums.pair();
}

/** The domain's fade of `frames` frames in `shape`, rising or falling. */
export function fadeCurve(shape: FadeShape, frames: number, rising: boolean): FadeCurve {
  return { kind: 'fade', origin: 0, step: 1, length: frames, shape, rising };
}

/** The largest level change in dB, unsigned, that a fade in `shape` makes of `pair`. */
export function largestLevelChange(pair: SpanPair, shape: FadeShape): number {
  const { frames, outPower: a, inPower: b, correlation } = pair;
  // Two spans under the floor are silence either side, and silence does not change.
  if (Math.max(a, b) < LEAST_DEVIATION) return 0;
  const falling = fadeCurve(shape, frames, false);
  const rising = fadeCurve(shape, frames, true);
  const cross = 2 * correlation * Math.sqrt(a * b);
  let largest = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    const out = gainAt(falling, frame);
    const into = gainAt(rising, frame);
    const t = frames > 1 ? frame / (frames - 1) : 1;
    const heard = out * out * a + into * into * b + cross * out * into;
    const expected = (1 - t) * a + t * b;
    const change = Math.abs(
      10 * log10(Math.max(heard, LEAST_DEVIATION) / Math.max(expected, LEAST_DEVIATION)),
    );
    if (change > largest) largest = change;
  }
  return largest;
}

/** The suitability of a crossfade over `pair`: the shape that changes the level least. */
export function crossfadeSuitability(pair: SpanPair): CrossfadeSuitability {
  let shape: FadeShape = FadeShape.Linear;
  let least = Number.POSITIVE_INFINITY;
  for (const candidate of FADE_SHAPES) {
    const change = largestLevelChange(pair, candidate);
    if (change < least) {
      least = change;
      shape = candidate;
    }
  }
  return {
    lengthFrames: pair.frames,
    correlation: pair.correlation,
    shape,
    levelChangeDb: least,
    verdict: verdictOf('crossfade', least),
  };
}
