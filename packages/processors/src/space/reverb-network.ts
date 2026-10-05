/**
 * The reverb's feedback delay network, after J.-M. Jot and A. Chaigne,
 * "Digital Delay Networks for Designing Artificial Reverberators", AES
 * Convention 90 (1991): eight delay lines, each read at its end, damped by
 * its own one-pole filter and mixed back into all eight by a Householder
 * matrix.
 *
 * - The lengths are the primes nearest above `size · L_i · rate / 48 000`
 *   for the stated primes `L_i` = 1499, 1889, 2381, 2999, 3371, 3803, 4177,
 *   4523 frames at 48 kHz (31 to 94 ms at the largest size), each above the
 *   one before, so they are distinct primes, mutually prime at every size
 *   and rate, and the echoes of one line never fall on another's.
 * - The feedback matrix is `A = I − (2/8)·𝟏𝟏ᵀ`: line `i` takes its own
 *   damped output less a quarter of the sum of all eight. `A` is orthogonal,
 *   so the mixing loses no energy and every loss is the lines' own.
 * - Line `i`, of `m` frames, is damped by `H(z) = g·(1 − b) / (1 − b·z⁻¹)`.
 *   Its gain at DC, `g = 10^(−3m / (RT60 · rate))`, from `decibelsToGain` of
 *   `−60m / (RT60 · rate)`, takes 60 dB from a sound every RT60 seconds
 *   whichever lines it passes through; its gain at the Nyquist frequency,
 *   `g·(1 − b)/(1 + b)`, is the `g` of a decay time shorter by the damping,
 *   `RT60 · (1 − damping)`, so `b = (1 − q)/(1 + q)` with `q` the ratio of
 *   the two gains.
 * - Every input channel enters every line alike, at `1 / √C` of `C`
 *   channels, so a sound's tail does not depend on the channel that carries
 *   it; distinct sign patterns would not do, since any two rows of signs
 *   cancel in half their places, and a sound common to two channels would
 *   reach only half the lines.
 * - Output channel `c` is `Σ_i h(c mod 8, i) / √8` of the lines, where
 *   `h(r, i) = (−1)^popcount(r AND i)` is the 8 × 8 Sylvester–Hadamard
 *   matrix. The lines' outputs are the input delayed by different primes,
 *   and the rows are orthogonal, so the outputs of up to eight channels are
 *   mutually decorrelated; a channel `c` past the eighth reads its lines
 *   `⌊c / 8⌋ · ⌊m / G⌋` frames before their ends, of `G` groups of eight,
 *   which decorrelates it from the channel eight before it. A mono input
 *   gives a mono reverb.
 * - The width blends each output channel with their mean: at 0 % every
 *   channel is the mean, at 100 % each is its own.
 *
 * The pre-delay delays what enters the lines, read between two frames by
 * linear interpolation as it moves. Each frame is worked out in turn, from
 * ramps, design clock and ring positions the kernel holds, so the output is
 * the same however the stream is cut.
 */

import {
  channelAt,
  decibelsToGain,
  portAt,
  unknownParameter,
  type AudioFrameBlock,
  type NodeKernel,
} from '@audiogubbins/audio-engine';
import type { DomainResult } from '@audiogubbins/domain';

import { finiteSample, flushSubnormal } from '../framework/sample-safety.js';
import { DesignClock } from '../filters/cascade-kernel.js';
import type { RampedParameter } from '../filters/ramped-parameter.js';

/** The lines of the network. */
const LINES = 8;

/** The primes each line's length is scaled from, in frames at {@link BASE_RATE}. */
const BASE_LENGTHS: readonly number[] = [1499, 1889, 2381, 2999, 3371, 3803, 4177, 4523];
const BASE_RATE = 48_000;

/** The share of the sum of the lines each line gives back: `2 / 8`. */
const HOUSEHOLDER = 2 / LINES;

/** `h(r, i)`, row-major: the sign of line `i` in row `r` of the Sylvester–Hadamard matrix. */
const HADAMARD = Float64Array.from({ length: LINES * LINES }, (_, at) => {
  let bits = Math.floor(at / LINES) & (at % LINES);
  let parity = 0;
  for (; bits > 0; bits >>= 1) parity ^= bits & 1;
  return parity === 0 ? 1 : -1;
});

function isPrime(value: number): boolean {
  if (value < 2) return false;
  for (let divisor = 2; divisor * divisor <= value; divisor += 1) {
    if (value % divisor === 0) return false;
  }
  return true;
}

/** Each line's length in frames at `size` and `rate`: distinct primes, rising. */
export function lineLengths(size: number, rate: number): number[] {
  const lengths: number[] = [];
  let previous = 1;
  for (const base of BASE_LENGTHS) {
    let length = Math.max(previous + 1, Math.ceil((size * base * rate) / BASE_RATE));
    while (!isPrime(length)) length += 1;
    lengths.push(length);
    previous = length;
  }
  return lengths;
}

/** What a reverb's kernel is made of. */
export interface NetworkParts {
  /** The type a refusal names. */
  readonly type: string;
  readonly channels: number;
  readonly rate: number;
  readonly lengths: readonly number[];
  /** The pre-delay ring's frames: the longest pre-delay, and the frame it is read between. */
  readonly preDelayFrames: number;
  readonly decay: RampedParameter;
  readonly damping: RampedParameter;
  readonly preDelay: RampedParameter;
  readonly width: RampedParameter;
}

export class ReverbKernel implements NodeKernel {
  readonly #parts: NetworkParts;
  readonly #byKey: ReadonlyMap<string, RampedParameter>;
  readonly #clock = new DesignClock();
  readonly #lines: readonly Float64Array[];
  readonly #positions = new Int32Array(LINES);
  /** Each line's filter: its input gain `g·(1 − b)`, its pole `b`, and its state. */
  readonly #through = new Float64Array(LINES);
  readonly #pole = new Float64Array(LINES);
  readonly #damped = new Float64Array(LINES);
  /** The pre-delay's ring of what enters the lines, and where it is written next. */
  readonly #waiting: Float64Array;
  #waitingPosition = 0;
  /**
   * What enters every line this frame, after the pre-delay, in an array: a
   * double held in a field can be boxed on every write.
   */
  readonly #entering = new Float64Array(1);
  /** Each output channel's sample this frame, before the width. */
  readonly #out: Float64Array;
  /** Where in its line each group of eight channels reads, back from its end. */
  readonly #tapOffsets: Int32Array;

  constructor(parts: NetworkParts) {
    this.#parts = parts;
    const ramps = [parts.decay, parts.damping, parts.preDelay, parts.width];
    this.#byKey = new Map(ramps.map((ramp) => [ramp.descriptor.key, ramp]));
    this.#lines = parts.lengths.map((length) => new Float64Array(length));
    this.#waiting = new Float64Array(parts.preDelayFrames);
    this.#out = new Float64Array(parts.channels);
    const groups = Math.ceil(parts.channels / LINES);
    this.#tapOffsets = new Int32Array(groups * LINES);
    for (let group = 0; group < groups; group += 1) {
      for (const [line, length] of parts.lengths.entries()) {
        this.#tapOffsets[group * LINES + line] = group * Math.floor(length / groups);
      }
    }
  }

  process(
    inputs: readonly AudioFrameBlock[],
    outputs: readonly AudioFrameBlock[],
    frames: number,
  ): void {
    const input = portAt(inputs, 0);
    const output = portAt(outputs, 0);
    const { decay, damping, preDelay, width } = this.#parts;
    decay.fill(frames);
    damping.fill(frames);
    preDelay.fill(frames);
    width.fill(frames);
    for (let frame = 0; frame < frames;) {
      if (this.#clock.due) this.#design(frame);
      const count = this.#clock.span(frames - frame);
      for (let at = frame; at < frame + count; at += 1) {
        this.#enter(input, at);
        this.#tap(output, at);
        this.#recirculate();
      }
      this.#clock.advance(count);
      frame += count;
    }
  }

  setParameter(name: string, value: number): DomainResult<void> {
    const ramp = this.#byKey.get(name);
    const { type } = this.#parts;
    return ramp === undefined ? unknownParameter(type, name) : ramp.set(type, value);
  }

  release(): void {
    // Holds only its own lines and rings, which are collected with it.
  }

  /** Each line's filter for the decay and damping the ramps reach at `frame`, where either moved. */
  #design(frame: number): void {
    const { decay, damping } = this.#parts;
    const moved = decay.moved(frame);
    if (damping.moved(frame) || moved) this.#designLines(frame);
  }

  /**
   * Each line's filter for the decay and damping at `frame`. Out of line, as
   * a moved parameter is too rare for V8 to inline a conversion called from
   * the branch it takes.
   */
  #designLines(frame: number): void {
    const { decay, damping, rate, lengths } = this.#parts;
    const seconds = decay.values[frame] ?? 0;
    const shorter = seconds * (1 - (damping.values[frame] ?? 0) / 100);
    for (let line = 0; line < LINES; line += 1) {
      const length = lengths[line] ?? 0;
      const gain = decibelsToGain((-60 * length) / (seconds * rate));
      const ratio = decibelsToGain((-60 * length) / (shorter * rate)) / gain;
      const pole = (1 - ratio) / (1 + ratio);
      this.#through[line] = gain * (1 - pole);
      this.#pole[line] = pole;
    }
  }

  /** What enters every line at `frame`: the input's channels summed, pre-delayed. */
  #enter(input: AudioFrameBlock, frame: number): void {
    const { channels, rate, preDelayFrames, preDelay } = this.#parts;
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      sum += finiteSample(channelAt(input, channel)[frame] ?? 0);
    }
    const delay = ((preDelay.values[frame] ?? 0) * rate) / 1_000;
    const whole = Math.floor(delay);
    const fraction = delay - whole;
    const position = this.#waitingPosition;
    const newer = position >= whole ? position - whole : position - whole + preDelayFrames;
    const older = newer === 0 ? preDelayFrames - 1 : newer - 1;
    const ring = this.#waiting;
    ring[position] = flushSubnormal(sum / Math.sqrt(channels));
    this.#entering[0] = (ring[newer] ?? 0) * (1 - fraction) + (ring[older] ?? 0) * fraction;
    this.#waitingPosition = position + 1 === preDelayFrames ? 0 : position + 1;
  }

  /** Each output channel at `frame`, from the lines' taps, blended with their mean by the width. */
  #tap(output: AudioFrameBlock, frame: number): void {
    const out = this.#out;
    const scale = 1 / Math.sqrt(LINES);
    let mean = 0;
    for (let channel = 0; channel < out.length; channel += 1) {
      const row = (channel % LINES) * LINES;
      const group = Math.floor(channel / LINES) * LINES;
      let sum = 0;
      for (let line = 0; line < LINES; line += 1) {
        const ring = this.#lines[line];
        if (ring === undefined) continue;
        let at = (this.#positions[line] ?? 0) + (this.#tapOffsets[group + line] ?? 0);
        if (at >= ring.length) at -= ring.length;
        sum += (HADAMARD[row + line] ?? 0) * (ring[at] ?? 0);
      }
      out[channel] = sum * scale;
      mean += sum * scale;
    }
    mean /= out.length;
    const width = (this.#parts.width.values[frame] ?? 0) / 100;
    for (let channel = 0; channel < out.length; channel += 1) {
      channelAt(output, channel)[frame] = mean + width * ((out[channel] ?? 0) - mean);
    }
  }

  /** Each line's end damped, mixed by the Householder matrix, and written back with what enters. */
  #recirculate(): void {
    const damped = this.#damped;
    let sum = 0;
    for (let line = 0; line < LINES; line += 1) {
      const ring = this.#lines[line];
      // An explicit test, not `?.[…]`: the optional read allocates in the
      // optimised code.
      const end = ring === undefined ? 0 : (ring[this.#positions[line] ?? 0] ?? 0);
      const state =
        (this.#through[line] ?? 0) * end + (this.#pole[line] ?? 0) * (damped[line] ?? 0);
      damped[line] = flushSubnormal(state);
      sum += damped[line] ?? 0;
    }
    const share = HOUSEHOLDER * sum;
    for (let line = 0; line < LINES; line += 1) {
      const ring = this.#lines[line];
      if (ring === undefined) continue;
      const position = this.#positions[line] ?? 0;
      ring[position] = flushSubnormal((this.#entering[0] ?? 0) + (damped[line] ?? 0) - share);
      this.#positions[line] = position + 1 === ring.length ? 0 : position + 1;
    }
  }
}
