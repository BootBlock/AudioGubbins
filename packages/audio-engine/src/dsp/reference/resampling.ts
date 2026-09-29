/**
 * The canonical resampler in TypeScript.
 *
 * `crates/resampling` repeated operation for operation (ADR-0032): the same
 * quality constants, the same kernel with its taps summed and scaled in the
 * same order, the same exact rational positions advanced by integer steps, and
 * the same convolution order. Its output is the Rust module's, bit for bit.
 */

import { ResamplingQuality } from '../canonical-dsp.js';
import { besselI0, kaiser, sineOfTurns } from './primitives.js';

/** Zero crossings, window shape and rolloff of each quality; see `quality.rs`. */
const QUALITY_SHAPES: Readonly<
  Record<ResamplingQuality, { zeroCrossings: number; beta: number; rolloff: number }>
> = {
  [ResamplingQuality.Maximum]: { zeroCrossings: 64, beta: 14, rolloff: 0.97 },
  [ResamplingQuality.High]: { zeroCrossings: 32, beta: 10, rolloff: 0.95 },
  [ResamplingQuality.Draft]: { zeroCrossings: 8, beta: 6, rolloff: 0.9 },
};

/** Coefficients kept in a table before phases are computed as needed; see `kernel.rs`. */
const TABLE_LIMIT = 1 << 20;

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

/** The interpolation filter for one conversion, as `Kernel` in `kernel.rs`. */
class Kernel {
  readonly outputStep: number;
  readonly inputStep: number;
  readonly half: number;
  readonly #halfWidth: number;
  readonly #cutoff: number;
  readonly #beta: number;
  readonly #besselOfBeta: number;
  readonly #table: Float64Array | undefined;

  constructor(outputStep: number, inputStep: number, quality: ResamplingQuality) {
    this.outputStep = outputStep;
    this.inputStep = inputStep;
    if (outputStep === inputStep) {
      // Equal rates copy the input exactly, as the crate's single unit tap.
      this.half = 0;
      this.#halfWidth = 1;
      this.#cutoff = 1;
      this.#beta = 0;
      this.#besselOfBeta = 1;
      this.#table = new Float64Array(outputStep).fill(1);
      return;
    }
    const shape = QUALITY_SHAPES[quality];
    const ratio = outputStep / inputStep;
    this.#cutoff = (ratio < 1 ? ratio : 1) * shape.rolloff;
    this.#halfWidth = shape.zeroCrossings / this.#cutoff;
    this.half = Math.ceil(this.#halfWidth);
    this.#beta = shape.beta;
    this.#besselOfBeta = besselI0(shape.beta);
    const size = this.taps * outputStep;
    this.#table = size <= TABLE_LIMIT ? this.#tabulate(size) : undefined;
  }

  get taps(): number {
    return 2 * this.half + 1;
  }

  #tabulate(size: number): Float64Array {
    const table = new Float64Array(size);
    for (let phase = 0; phase < this.outputStep; phase += 1) {
      this.fillPhase(phase, table.subarray(phase * this.taps, (phase + 1) * this.taps));
    }
    return table;
  }

  #coefficient(n: number, phase: number): number {
    const t = (n * this.outputStep + phase) / this.outputStep;
    if (Math.abs(t) >= this.#halfWidth) return 0;
    const x = this.#cutoff * t;
    const sinc = x === 0 ? 1 : sineOfTurns(x / 2) / (Math.PI * x);
    const window = kaiser(t / this.#halfWidth, this.#beta, this.#besselOfBeta);
    return this.#cutoff * sinc * window;
  }

  /** The taps of `phase` for `n` from `-K` to `K`, scaled to sum to one. */
  fillPhase(phase: number, taps: Float64Array): void {
    let sum = 0;
    for (let index = 0; index < taps.length; index += 1) {
      const tap = this.#coefficient(index - this.half, phase);
      taps[index] = tap;
      sum += tap;
    }
    for (let index = 0; index < taps.length; index += 1) {
      taps[index] = (taps[index] ?? 0) / sum;
    }
  }

  phaseTaps(phase: number, scratch: Float64Array): Float64Array {
    if (this.#table !== undefined) {
      return this.#table.subarray(phase * this.taps, (phase + 1) * this.taps);
    }
    this.fillPhase(phase, scratch);
    return scratch;
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
  readonly #scratch: Float64Array;

  /** Settings already checked by `checkResampler`. */
  constructor(from: number, to: number, channels: number, quality: ResamplingQuality) {
    const divisor = greatestCommonDivisor(from, to);
    this.#kernel = new Kernel(to / divisor, from / divisor, quality);
    this.#history = Array.from({ length: channels }, () => new SampleHistory());
    this.#scratch = new Float64Array(this.#kernel.taps);
  }

  get lookahead(): number {
    return this.#kernel.half;
  }

  get channels(): number {
    return this.#history.length;
  }

  get drained(): boolean {
    return this.#finished && this.#index >= this.#received;
  }

  /** Answers whether the input was taken; see `push` in `stream.rs`. */
  push(input: readonly Float32Array[]): boolean {
    const frames = input[0]?.length ?? 0;
    if (
      this.#finished ||
      input.length !== this.#history.length ||
      input.some((channel) => channel.length !== frames)
    ) {
      return false;
    }
    this.#history.forEach((kept, channel) => {
      const arriving = input[channel];
      if (arriving !== undefined) kept.append(arriving);
    });
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

  #ready(): boolean {
    return this.#finished
      ? this.#index < this.#received
      : this.#index + this.#kernel.half < this.#received;
  }

  /** `Σ x[i − n] · h[n]` for `n` from `−K` to `K`, in that order, per channel. */
  #writeSample(output: readonly Float32Array[], at: number): void {
    const taps = this.#kernel.phaseTaps(this.#phase, this.#scratch);
    const half = this.#kernel.half;
    this.#history.forEach((channel, index) => {
      const target = output[index];
      if (target === undefined) return;
      let sum = 0;
      for (let tap = 0; tap < taps.length; tap += 1) {
        const source = this.#index - (tap - half);
        if (source >= 0 && source < this.#received) {
          sum += channel.at(source - this.#base) * (taps[tap] ?? 0);
        }
      }
      target[at] = sum;
    });
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
