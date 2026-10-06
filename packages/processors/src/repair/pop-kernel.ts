/**
 * The de-pop's kernel: each channel split into its low band and the rest, the
 * low band's power measured against its local floor, and the low band of each
 * pop turned down to the floor, a fixed latency after the input.
 *
 * Each frame is worked out in turn, every channel alike and alone. The low
 * band `l` is the moving-average split's (`moving-average.ts`), aligned with
 * the input `Δ` frames before, and the output is `x − (1 − g) · l`, so where
 * the gain `g` is 1, nearly everywhere, the output is the input itself, bit
 * for bit, and what is taken is the low band alone. The power and the floor
 * are those `pop-geometry.ts` states, the power's running sum made exact
 * again from its window every `W` frames, counted from the kernel's first,
 * so rounding cannot gather and the sum is the same however the stream is
 * cut; the floor is a running minimum kept in a queue of rising powers.
 *
 * A run starts at a frame whose power is more than the sensitivity above the
 * floor, and more than 10⁻¹⁰ of full scale. Its first `H` frames are then
 * judged: its core is the frames from the first to the last whose power is both
 * above the threshold and within 30 dB of the most power among them. A core no
 * longer than `M + W` that ends `W` frames before the horizon is a pop; any
 * other is a note, and left. The level beside a pop is the lesser of the mean
 * power over the `W` frames before its run and over the `W` frames from `W`
 * after its core, so a note that follows does not raise it. Over the core the
 * gain is `√(level / power)`, at most 1, which leaves the low band at that
 * level, and over `h` frames either side it is crossfaded to 1 by a raised
 * cosine; where two repairs overlap, the lower gain stands. Once judged, the
 * run is passed over until `W` frames in turn are below the threshold.
 */

import type { DomainResult } from '@audiogubbins/domain';
import {
  channelAt,
  cosineOfTurns,
  decibelsToGain,
  portAt,
  unknownParameter,
  type AudioFrameBlock,
  type NodeKernel,
} from '@audiogubbins/audio-engine';

import { finiteSample } from '../framework/sample-safety.js';
import type { RampedParameter } from '../filters/ramped-parameter.js';
import type { MovingAverageLowPass } from './moving-average.js';
import type { PopGeometry } from './pop-geometry.js';

/** The least power a pop has: −100 dB of full scale, below which nothing is heard. */
const SMALLEST_POWER = 1e-10;

/** The share of its peak power within which a pop's core lies: −30 dB. */
const CORE_SHARE = 1e-3;

/** What a channel's detector is doing. */
const Scan = { Idle: 0, Judging: 1, Passing: 2 } as const;
type Scan = (typeof Scan)[keyof typeof Scan];

/** One channel's rings and detector. */
class PopChannel {
  readonly input: Float64Array;
  readonly low: Float64Array;
  readonly power: Float64Array;
  readonly floor: Float64Array;
  /** The gain each frame's low band is given, 1 until a repair lowers it. */
  readonly gain: Float64Array;
  /** The frames of the floor's queue, the least power at its head and rising. */
  readonly queue: Float64Array;
  head = 0;
  tail = 0;
  /** The sum of the squares of the last `W` frames of the low band. */
  sum = 0;
  scan: Scan = Scan.Idle;
  /** Where the run being judged started. */
  start = 0;
  /** Frames in turn below the threshold, while a judged run is passed over. */
  below = 0;

  constructor(geometry: PopGeometry) {
    const frames = geometry.ringFrames;
    this.input = new Float64Array(frames);
    this.low = new Float64Array(frames);
    this.power = new Float64Array(frames);
    this.floor = new Float64Array(frames);
    this.gain = new Float64Array(frames).fill(1);
    this.queue = new Float64Array(2 * geometry.reach + 2);
  }
}

/** What a de-pop kernel is made of. */
export interface PopParts {
  readonly type: string;
  readonly geometry: PopGeometry;
  /** The split at the pop frequency, over every channel. */
  readonly split: MovingAverageLowPass;
  readonly sensitivity: RampedParameter;
  readonly channels: number;
}

export class PopKernel implements NodeKernel {
  readonly #parts: PopParts;
  readonly #channels: readonly PopChannel[];
  /**
   * The threshold as a ratio of powers, read in place rather than returned,
   * where a double would be boxed.
   */
  readonly #threshold = new Float64Array(1);
  /**
   * The mean powers before and after the pop being repaired, then the level
   * beside it as a power, at 0, 1 and 2.
   */
  readonly #level = new Float64Array(3);
  /** The absolute frame worked out next, counted from the kernel's first. */
  #position = 0;

  constructor(parts: PopParts) {
    this.#parts = parts;
    this.#channels = Array.from({ length: parts.channels }, () => new PopChannel(parts.geometry));
  }

  process(
    inputs: readonly AudioFrameBlock[],
    outputs: readonly AudioFrameBlock[],
    frames: number,
  ): void {
    const input = portAt(inputs, 0);
    const output = portAt(outputs, 0);
    const sensitivity = this.#parts.sensitivity;
    sensitivity.fill(frames);
    for (let frame = 0; frame < frames; frame += 1) {
      if (sensitivity.moved(frame)) {
        this.#threshold[0] = decibelsToGain(2 * (sensitivity.values[frame] ?? 0));
      }
      for (let channel = 0; channel < this.#channels.length; channel += 1) {
        this.#frame(channel, input, output, frame);
      }
      this.#position += 1;
    }
  }

  setParameter(name: string, value: number): DomainResult<void> {
    const { type, sensitivity } = this.#parts;
    return name === sensitivity.descriptor.key
      ? sensitivity.set(type, value)
      : unknownParameter(type, name);
  }

  release(): void {
    // Holds only its own rings, which are collected with it.
  }

  /** The ring index of absolute frame `frame`, which may be before the first. */
  #index(frame: number): number {
    const frames = this.#parts.geometry.ringFrames;
    const index = frame % frames;
    return index < 0 ? index + frames : index;
  }

  #frame(channel: number, input: AudioFrameBlock, output: AudioFrameBlock, frame: number): void {
    const state = this.#channels[channel];
    if (state === undefined) return;
    const { geometry, split } = this.#parts;
    const position = this.#position;
    const samples = channelAt(input, channel);
    split.run(channel, samples, frame, position);
    state.input[this.#index(position)] = finiteSample(samples[frame] ?? 0);
    const aligned = position - geometry.alignment;
    const at = this.#index(aligned);
    state.low[at] = split.output[0] ?? 0;
    state.gain[at] = 1;
    this.#measure(state, aligned);
    this.#scan(state, aligned - geometry.half - geometry.reach);
    const out = this.#index(position - geometry.latency);
    const gain = state.gain[out] ?? 1;
    const dry = state.input[out] ?? 0;
    channelAt(output, channel)[frame] = gain === 1 ? dry : dry - (1 - gain) * (state.low[out] ?? 0);
  }

  /**
   * Takes the low band's frame `aligned` into the power centred `h` frames
   * before it, and the floor centred `h + R` before it.
   */
  #measure(state: PopChannel, aligned: number): void {
    const { period, half, reach } = this.#parts.geometry;
    if ((aligned + 1) % period === 0) {
      let sum = 0;
      for (let frame = aligned - period + 1; frame <= aligned; frame += 1) {
        const value = state.low[this.#index(frame)] ?? 0;
        sum += value * value;
      }
      state.sum = sum;
    } else {
      const low = state.low[this.#index(aligned)] ?? 0;
      const old = state.low[this.#index(aligned - period)] ?? 0;
      state.sum = state.sum + low * low - old * old;
    }
    const centre = aligned - half;
    const power = Math.max(state.sum, 0) / period;
    state.power[this.#index(centre)] = power;
    const queue = state.queue;
    const capacity = queue.length;
    while (
      state.tail > state.head &&
      (state.power[this.#index(queue[(state.tail - 1) % capacity] ?? 0)] ?? 0) >= power
    ) {
      state.tail -= 1;
    }
    queue[state.tail % capacity] = centre;
    state.tail += 1;
    const measured = centre - reach;
    while ((queue[state.head % capacity] ?? 0) < measured - reach) state.head += 1;
    state.floor[this.#index(measured)] =
      state.power[this.#index(queue[state.head % capacity] ?? 0)] ?? 0;
  }

  /** Moves the detector past frame `frame`, whose power and floor are now known. */
  #scan(state: PopChannel, frame: number): void {
    const { horizon, period } = this.#parts.geometry;
    const at = this.#index(frame);
    const power = state.power[at] ?? 0;
    const above =
      power > (this.#threshold[0] ?? 0) * (state.floor[at] ?? 0) && power > SMALLEST_POWER;
    if (state.scan === Scan.Idle) {
      if (above) {
        state.scan = Scan.Judging;
        state.start = frame;
      }
    } else if (state.scan === Scan.Judging) {
      if (frame - state.start === horizon) {
        this.#judge(state, state.start);
        state.scan = Scan.Passing;
        state.below = 0;
      }
    } else {
      state.below = above ? 0 : state.below + 1;
      if (state.below >= period) state.scan = Scan.Idle;
    }
  }

  /** Repairs the run from `start` where its core is short enough to be a pop. */
  #judge(state: PopChannel, start: number): void {
    const { horizon, longest, period } = this.#parts.geometry;
    let peak = 0;
    for (let frame = start; frame <= start + horizon; frame += 1) {
      peak = Math.max(peak, state.power[this.#index(frame)] ?? 0);
    }
    const least = CORE_SHARE * peak;
    const threshold = this.#threshold[0] ?? 0;
    let first = -1;
    let last = -1;
    for (let frame = start; frame <= start + horizon; frame += 1) {
      const at = this.#index(frame);
      const power = state.power[at] ?? 0;
      if (power >= least && power > threshold * (state.floor[at] ?? 0)) {
        if (first < 0) first = frame;
        last = frame;
      }
    }
    if (first < 0 || last - first + 1 > longest + period || last + period > start + horizon) {
      return;
    }
    this.#meanPower(state, start - period, 0);
    this.#meanPower(state, last + period, 1);
    this.#level[2] = Math.min(this.#level[0] ?? 0, this.#level[1] ?? 0);
    this.#lower(state, first, last);
  }

  /** Writes the mean power of the `W` frames from `from` to the level's place `into`. */
  #meanPower(state: PopChannel, from: number, into: number): void {
    const period = this.#parts.geometry.period;
    let sum = 0;
    for (let frame = from; frame < from + period; frame += 1) {
      sum += state.power[this.#index(frame)] ?? 0;
    }
    this.#level[into] = sum / period;
  }

  /** Lowers the low band over the core from `first` to `last`, and its crossfades, to the level. */
  #lower(state: PopChannel, first: number, last: number): void {
    const half = this.#parts.geometry.half;
    for (let frame = first - half; frame <= last + half; frame += 1) {
      const at = this.#index(frame);
      const power = state.power[at] ?? 0;
      const lowered = power > 0 ? Math.min(1, Math.sqrt((this.#level[2] ?? 0) / power)) : 1;
      const away = frame < first ? first - frame : frame > last ? frame - last : 0;
      const weight = away === 0 ? 1 : 0.5 + 0.5 * cosineOfTurns(away / (2 * (half + 1)));
      const gain = 1 - weight * (1 - lowered);
      state.gain[at] = Math.min(state.gain[at] ?? 1, gain);
    }
  }
}
