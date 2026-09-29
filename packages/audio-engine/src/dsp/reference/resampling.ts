/**
 * The canonical resampler in TypeScript.
 *
 * `crates/resampling` repeated operation for operation (ADR-0032): the same
 * quality constants, the same filter design evaluated in the same order, the
 * same kernel with its taps summed and scaled in the same order, the same
 * exact rational positions advanced by integer steps, and the same
 * convolution order. Its output is the Rust module's, bit for bit.
 */

import {
  CoefficientStrategy,
  ResamplingQuality,
  type ResamplerCoefficients,
} from '../canonical-dsp.js';
import { besselI0, kaiser, sineOfTurns } from './primitives.js';

/** Each quality's passband edge and design attenuation; see `quality.rs`. */
const QUALITY_SHAPES: Readonly<
  Record<ResamplingQuality, { passbandEdge: number; designAttenuation: number }>
> = {
  [ResamplingQuality.Maximum]: { passbandEdge: 0.97, designAttenuation: 146 },
  [ResamplingQuality.High]: { passbandEdge: 0.95, designAttenuation: 103 },
  [ResamplingQuality.Draft]: { passbandEdge: 0.9, designAttenuation: 63 },
};

function greatestCommonDivisor(left: number, right: number): number {
  let a = left;
  let b = right;
  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

/** The bytes a table of every phase takes: its taps, and a flag per phase. */
function bytesOfTable(taps: number, phases: number): number {
  return taps * phases * Float64Array.BYTES_PER_ELEMENT + phases;
}

/**
 * The interpolation filter for one conversion, as `Kernel` in `kernel.rs`:
 * the design, and either a table each phase fills the first time it is used,
 * where the table fits in the budget and can be allocated, or one phase's
 * taps computed for each output sample.
 */
class Kernel {
  readonly outputStep: number;
  readonly inputStep: number;
  readonly half: number;
  readonly taps: number;
  /**
   * The taps: every phase's, phase `p`'s from `p · taps` once `#filled[p]` is
   * set, where there is a table; one phase's, computed as asked, where not.
   */
  readonly coefficients: Float64Array;
  /** Which phases the table holds; `undefined` where the taps are computed. */
  readonly #filled: Uint8Array | undefined;
  readonly #halfWidth: number;
  readonly #cutoff: number;
  readonly #beta: number;
  readonly #besselOfBeta: number;

  /** A table where it fits in `budget` bytes and can be allocated, as `Kernel::new`. */
  constructor(outputStep: number, inputStep: number, quality: ResamplingQuality, budget: number) {
    this.outputStep = outputStep;
    this.inputStep = inputStep;
    if (outputStep === inputStep) {
      // Equal rates copy the input exactly, as the crate's single unit tap.
      this.half = 0;
      this.#halfWidth = 1;
      this.#cutoff = 1;
      this.#beta = 0;
      this.#besselOfBeta = 1;
    } else {
      // The crate's design, each expression in its order; see `Kernel::new`.
      const shape = QUALITY_SHAPES[quality];
      const ratio = outputStep / inputStep;
      const nyquist = ratio < 1 ? ratio : 1;
      const edge = shape.passbandEdge;
      this.#cutoff = (nyquist * (edge + 1)) / 2;
      const transition = nyquist * (1 - edge);
      this.#halfWidth = (shape.designAttenuation - 7.95) / (4.57 * Math.PI * transition);
      this.half = Math.ceil(this.#halfWidth);
      this.#beta = 0.1102 * (shape.designAttenuation - 8.7);
      this.#besselOfBeta = besselI0(this.#beta);
    }
    this.taps = 2 * this.half + 1;
    const table = Kernel.#tableWithin(this.taps, outputStep, budget);
    this.coefficients = table?.coefficients ?? new Float64Array(this.taps);
    this.#filled = table?.filled;
  }

  /** An empty table, when it fits in `budget` bytes and can be allocated. */
  static #tableWithin(
    taps: number,
    phases: number,
    budget: number,
  ): { coefficients: Float64Array; filled: Uint8Array } | undefined {
    if (bytesOfTable(taps, phases) > budget) return undefined;
    try {
      return { coefficients: new Float64Array(taps * phases), filled: new Uint8Array(phases) };
    } catch (error) {
      // A typed array the engine cannot allocate throws a RangeError; the
      // taps are then computed as they are used, as the crate does when it
      // cannot reserve the table.
      if (!(error instanceof RangeError)) throw error;
      return undefined;
    }
  }

  get report(): ResamplerCoefficients {
    return this.#filled === undefined
      ? { strategy: CoefficientStrategy.Computed, tableBytes: 0 }
      : {
          strategy: CoefficientStrategy.Table,
          tableBytes: bytesOfTable(this.taps, this.outputStep),
        };
  }

  #coefficient(n: number, phase: number): number {
    const t = (n * this.outputStep + phase) / this.outputStep;
    if (Math.abs(t) >= this.#halfWidth) return 0;
    const x = this.#cutoff * t;
    const sinc = x === 0 ? 1 : sineOfTurns(x / 2) / (Math.PI * x);
    const window = kaiser(t / this.#halfWidth, this.#beta, this.#besselOfBeta);
    return this.#cutoff * sinc * window;
  }

  /** Writes the taps of `phase` from `start`, for `n` from `-K` to `K`, scaled to sum to one. */
  #fillPhase(phase: number, start: number): void {
    const table = this.coefficients;
    let sum = 0;
    for (let index = 0; index < this.taps; index += 1) {
      const tap = this.#coefficient(index - this.half, phase);
      table[start + index] = tap;
      sum += tap;
    }
    for (let index = start; index < start + this.taps; index += 1) {
      table[index] = (table[index] ?? 0) / sum;
    }
  }

  /**
   * Where the taps of `phase` start in {@link coefficients}: in the table,
   * filled the first time, or computed now at the start.
   */
  phaseOffset(phase: number): number {
    const filled = this.#filled;
    if (filled === undefined) {
      this.#fillPhase(phase, 0);
      return 0;
    }
    const start = phase * this.taps;
    if (filled[phase] === 0) {
      this.#fillPhase(phase, start);
      filled[phase] = 1;
    }
    return start;
  }
}

/**
 * One channel's input from an absolute index on, in a typed array that grows
 * by doubling and compacts when its front is forgotten, so a long stream costs
 * a copy now and then rather than a boxed number per sample.
 */
class SampleHistory {
  #samples = new Float32Array(1024);
  #start = 0;
  #length = 0;

  /** The sample `offset` frames after the first one kept. */
  at(offset: number): number {
    return this.#samples[this.#start + offset] ?? 0;
  }

  append(arriving: Float32Array): void {
    if (this.#start + this.#length + arriving.length > this.#samples.length) {
      const needed = this.#length + arriving.length;
      let capacity = this.#samples.length;
      while (capacity < needed) capacity *= 2;
      // Compacted in place where it already has room: `set` copies correctly
      // between overlapping views of one buffer.
      const grown = capacity === this.#samples.length ? this.#samples : new Float32Array(capacity);
      grown.set(this.#samples.subarray(this.#start, this.#start + this.#length));
      this.#samples = grown;
      this.#start = 0;
    }
    this.#samples.set(arriving, this.#start + this.#length);
    this.#length += arriving.length;
  }

  forget(frames: number): void {
    this.#start += frames;
    this.#length -= frames;
  }

  clear(): void {
    this.#start = 0;
    this.#length = 0;
  }
}

/** A streaming converter, as `StreamingResampler` in `stream.rs`. */
export class ReferenceResampler {
  readonly #kernel: Kernel;
  readonly #history: SampleHistory[];
  #base = 0;
  #received = 0;
  #finished = false;
  #index = 0;
  #phase = 0;

  /**
   * Settings already checked by `checkResampler`, with the budget for the
   * filter's table in bytes: `Infinity` where the caller measured no bound.
   */
  constructor(
    from: number,
    to: number,
    channels: number,
    quality: ResamplingQuality,
    coefficientBudget: number,
  ) {
    const divisor = greatestCommonDivisor(from, to);
    this.#kernel = new Kernel(to / divisor, from / divisor, quality, coefficientBudget);
    this.#history = Array.from({ length: channels }, () => new SampleHistory());
  }

  get lookahead(): number {
    return this.#kernel.half;
  }

  get channels(): number {
    return this.#history.length;
  }

  get coefficients(): ResamplerCoefficients {
    return this.#kernel.report;
  }

  get drained(): boolean {
    return this.#finished && this.#index >= this.#received;
  }

  /**
   * Appends input whose shape `framesOfPlanar` has checked, and answers
   * whether it was taken: not after the end; see `push` in `stream.rs`.
   */
  push(input: readonly Float32Array[], frames: number): boolean {
    if (this.#finished) return false;
    for (let channel = 0; channel < this.#history.length; channel += 1) {
      const arriving = input[channel];
      if (arriving !== undefined) this.#history[channel]?.append(arriving);
    }
    this.#received += frames;
    return true;
  }

  finish(): void {
    this.#finished = true;
  }

  pull(output: readonly Float32Array[]): number {
    const capacity = output[0]?.length ?? 0;
    let written = 0;
    while (written < capacity && this.#ready()) {
      this.#writeSample(output, written);
      this.#advance();
      written += 1;
    }
    this.#forgetConsumed();
    return written;
  }

  /**
   * Moves to output frame `frame`, a whole number `assertSeekFrame` has
   * checked, and answers the input frame to resume from; see `seek` in
   * `stream.rs`. The position `frame · M` can pass 2⁵³, so it is exact in a
   * `bigint`; an input frame past 2⁵³ throws, as the module answers -1.
   */
  seek(frame: number): number {
    const position = BigInt(frame) * BigInt(this.#kernel.inputStep);
    const step = BigInt(this.#kernel.outputStep);
    const index = position / step;
    if (index > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`Output frame ${String(frame)} is past the input a resampler can count.`);
    }
    this.#index = Number(index);
    this.#phase = Number(position % step);
    const start = Math.max(0, this.#index - this.#kernel.half);
    for (const channel of this.#history) channel.clear();
    this.#base = start;
    this.#received = start;
    this.#finished = false;
    return start;
  }

  #ready(): boolean {
    return this.#finished
      ? this.#index < this.#received
      : this.#index + this.#kernel.half < this.#received;
  }

  /** `Σ x[i − n] · h[n]` for `n` from `−K` to `K`, in that order, per channel. */
  #writeSample(output: readonly Float32Array[], at: number): void {
    const kernel = this.#kernel;
    const table = kernel.coefficients;
    const offset = kernel.phaseOffset(this.#phase);
    const half = kernel.half;
    const centre = this.#index;
    const received = this.#received;
    const base = this.#base;
    for (let index = 0; index < this.#history.length; index += 1) {
      const channel = this.#history[index];
      const target = output[index];
      if (channel === undefined || target === undefined) continue;
      let sum = 0;
      for (let tap = 0; tap < kernel.taps; tap += 1) {
        const source = centre - (tap - half);
        if (source >= 0 && source < received) {
          sum += channel.at(source - base) * (table[offset + tap] ?? 0);
        }
      }
      target[at] = sum;
    }
  }

  #advance(): void {
    const next = this.#phase + this.#kernel.inputStep;
    this.#index += Math.floor(next / this.#kernel.outputStep);
    this.#phase = next % this.#kernel.outputStep;
  }

  #forgetConsumed(): void {
    const keepFrom = Math.max(0, this.#index - this.#kernel.half);
    if (keepFrom <= this.#base) return;
    const drop = Math.min(keepFrom - this.#base, this.#received - this.#base);
    for (const channel of this.#history) channel.forget(drop);
    this.#base += drop;
  }
}
