/**
 * Dither and quantisation: the last step before an integer encoder, turning
 * rendered floating-point blocks into values each exactly `k / 2^(bits-1)`
 * for an integer `k` of the target depth (ADR-0092).
 *
 * Each sample is quantised by `quantiseSample`, the rule the writers apply,
 * so a writer given these values writes `k` back unchanged. Before it, the
 * sample has the dither added, rectangular or triangular noise drawn from the
 * counter-based generator under the export's key, one stream for each
 * channel, and, where noise shaping is asked, the filtered errors of the
 * samples before it subtracted (`noise-shaping.ts`). The error fed back is the
 * quantiser's own: where a sample is clipped at the depth's end, the overload
 * is not fed back, since a filter driven by it would ring.
 *
 * The step keeps its place and its filters' errors across blocks, and a draw
 * depends on the frame's place alone, so the blocks an export is rendered in
 * never change a bit of it. A 32-bit `k / 2^31` needs more precision than a
 * 32-bit float holds, so a depth past 24 bits is written into `Float64Array`s.
 */

import { quantiseSample } from '@audiogubbins/codecs';

import { uniformDraw } from './dither-noise.js';
import type { DitherSettings } from './export-settings.js';
import { shapingCoefficients } from './noise-shaping.js';

/** The deepest integer a 32-bit float holds every value `k / 2^(bits-1)` of exactly. */
const DEEPEST_IN_FLOAT32 = 24;

/** What a quantiser is made with. */
export interface QuantiserSettings {
  /** The integer depth, 8 to 32. */
  readonly bits: number;
  readonly dither: DitherSettings;

  /** The generator's key (`ditherKey`). */
  readonly key: number;
  readonly channels: number;
}

/** The noise of one frame of one channel, in steps of the depth. */
type NoiseOf = (channel: number, frame: number) => number;

function noiseOf(
  dither: DitherSettings,
  key: number,
): { readonly draw: NoiseOf; readonly peak: number } {
  switch (dither.kind) {
    case 'none':
      return { draw: () => 0, peak: 0 };
    case 'rectangular':
      return {
        draw: (channel, frame) => dither.amplitude * (uniformDraw(key, channel, frame) - 0.5),
        peak: dither.amplitude / 2,
      };
    case 'triangular':
      return {
        draw: (channel, frame) =>
          dither.amplitude *
          (uniformDraw(key, channel, 2 * frame) + uniformDraw(key, channel, 2 * frame + 1) - 1),
        peak: dither.amplitude,
      };
  }
}

/** Quantises an export's blocks, one after another, to an integer depth. */
export class Quantiser {
  readonly #bits: number;
  readonly #scale: number;
  readonly #noise: NoiseOf;

  /** The largest error the quantiser itself makes: half a step, and the dither's peak. */
  readonly #largestError: number;
  readonly #coefficients: Float64Array;

  /** Each channel's last errors, the latest first. */
  readonly #errors: readonly Float64Array[];

  /** The frame the next block begins at. */
  #frame = 0;

  constructor(settings: QuantiserSettings) {
    this.#bits = settings.bits;
    this.#scale = 2 ** (settings.bits - 1);
    const noise = noiseOf(settings.dither, settings.key);
    this.#noise = noise.draw;
    this.#largestError = 0.5 + noise.peak;
    const shaping = settings.dither.kind === 'none' ? 'none' : settings.dither.shaping;
    this.#coefficients = Float64Array.from(shapingCoefficients(shaping));
    this.#errors = Array.from(
      { length: settings.channels },
      () => new Float64Array(this.#coefficients.length),
    );
  }

  /**
   * Quantises `frames` frames of `input` into `output`, one array for each
   * channel. An output may be the input itself where the depth fits a 32-bit
   * float.
   */
  quantise(
    input: readonly Float32Array[],
    frames: number,
    output: readonly (Float32Array | Float64Array)[],
  ): void {
    for (let channel = 0; channel < this.#errors.length; channel += 1) {
      const to = output[channel];
      const from = input[channel];
      const errors = this.#errors[channel];
      if (to === undefined || from === undefined || errors === undefined) {
        throw new RangeError(`The quantiser needs channel ${String(channel)} in and out.`);
      }
      if (to instanceof Float32Array && this.#bits > DEEPEST_IN_FLOAT32) {
        throw new RangeError(
          `A ${String(this.#bits)}-bit sample does not fit a 32-bit float; write it into a Float64Array.`,
        );
      }
      this.#channel(channel, from, to, errors, frames);
    }
    this.#frame += frames;
  }

  #channel(
    channel: number,
    from: Float32Array,
    to: Float32Array | Float64Array,
    errors: Float64Array,
    frames: number,
  ): void {
    const scale = this.#scale;
    const coefficients = this.#coefficients;
    const taps = coefficients.length;
    const largest = this.#largestError;
    for (let offset = 0; offset < frames; offset += 1) {
      let wanted = (from[offset] ?? 0) * scale;
      for (let tap = 0; tap < taps; tap += 1) {
        wanted -= (coefficients[tap] ?? 0) * (errors[tap] ?? 0);
      }
      const dithered = wanted + this.#noise(channel, this.#frame + offset);
      const integer = quantiseSample(dithered / scale, this.#bits);
      if (taps > 0) {
        errors.copyWithin(1, 0, taps - 1);
        // A sample that is not a number quantises to zero and leaves no error to shape.
        const error = integer - wanted;
        errors[0] = Number.isNaN(error) ? 0 : Math.min(largest, Math.max(-largest, error));
      }
      to[offset] = integer / scale;
    }
  }
}
