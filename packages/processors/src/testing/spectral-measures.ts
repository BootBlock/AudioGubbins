/**
 * What the spectral processors' tests are measured with: a noise profile
 * learned as the application learns one, from each channel's own noise, a
 * sine's level and its signal-to-noise ratio by a least-squares fit, a room
 * made by a synthetic exponential impulse response, and the share of a
 * signal's energy that is late reverberation.
 */

import {
  sampleRate,
  type ChannelLayout,
  type DomainResult,
  type ParameterValue,
  type ProcessorState,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { REFERENCE_DSP } from '@audiogubbins/audio-engine';
import { noise } from '@audiogubbins/test-fixtures';

import type { LearningSettings, StateLearner } from '../framework/processor-type.js';
import { NOISE_REDUCTION } from '../spectral/noise-reduction.js';
import { TEST_RATE, processorValues } from './processor-run.js';

/**
 * The learner of a noise reduction's profile, as its type offers it to
 * whatever learns a processor's state, the detection worker among them.
 */
export function noiseLearner(settings: LearningSettings): DomainResult<StateLearner> {
  const learner = NOISE_REDUCTION.learner;
  if (learner === undefined) throw new Error('The noise reduction offers no learner.');
  return learner(settings);
}

/** The profile a noise reduction of `values` learns from `stretch`, all of it in one call. */
export function learnedProfile(
  layout: ChannelLayout,
  stretch: readonly Float32Array[],
  values: Readonly<Record<string, ParameterValue>> = {},
  rate: number = TEST_RATE,
): ProcessorState {
  const learner = expectSuccess(
    noiseLearner({
      values: processorValues(NOISE_REDUCTION, values),
      input: layout,
      sampleRate: expectSuccess(sampleRate(rate)),
      dsp: REFERENCE_DSP,
    }),
  );
  learner.add(stretch, stretch[0]?.length ?? 0);
  const profile = learner.result();
  learner.release();
  return profile;
}

/** `signal` from frame `frames` on, so a processor's output lines up with its input. */
export function advanced(signal: Float32Array, frames: number): Float32Array {
  const out = new Float32Array(signal.length);
  out.set(signal.subarray(frames));
  return out;
}

/**
 * The sine of `frequency` that best fits `signal` over `[from, to)` by least
 * squares, its amplitude, and the ratio in decibels of its energy to the
 * energy of what is left, the signal-to-noise ratio of a sine in noise.
 */
export function sineFit(
  signal: Float32Array,
  frequency: number,
  from: number,
  to: number,
): { readonly amplitude: number; readonly snr: number } {
  const turn = (frame: number) => (2 * Math.PI * frequency * frame) / TEST_RATE;
  let [cc, ss, cs, xc, xs] = [0, 0, 0, 0, 0];
  for (let frame = from; frame < to; frame += 1) {
    const [c, s, x] = [Math.cos(turn(frame)), Math.sin(turn(frame)), signal[frame] ?? 0];
    [cc, ss, cs, xc, xs] = [cc + c * c, ss + s * s, cs + c * s, xc + x * c, xs + x * s];
  }
  const determinant = cc * ss - cs * cs;
  const a = (xc * ss - xs * cs) / determinant;
  const b = (xs * cc - xc * cs) / determinant;
  let [fitted, left] = [0, 0];
  for (let frame = from; frame < to; frame += 1) {
    const model = a * Math.cos(turn(frame)) + b * Math.sin(turn(frame));
    fitted += model * model;
    left += ((signal[frame] ?? 0) - model) ** 2;
  }
  return { amplitude: Math.hypot(a, b), snr: 10 * Math.log10(fitted / left) };
}

/** Bursts of noise in a period of `PERIOD` seconds: `ON` seconds of noise, then silence. */
const PERIOD = 0.5;
const ON = 0.15;

/**
 * Noise bursts `ON` seconds long every `PERIOD` seconds, at an amplitude of
 * 0.5, over a `floor` of steady noise, the dry sound of a room's test.
 */
export function bursts(length: number, floor = 0): Float32Array {
  const burst = noise(3, { length, amplitude: 0.5 }).channels[0] ?? new Float32Array(length);
  const steady = noise(5, { length, amplitude: floor }).channels[0] ?? new Float32Array(length);
  return burst.map(
    (sample, frame) =>
      (frame % (PERIOD * TEST_RATE) < ON * TEST_RATE ? sample : 0) + (steady[frame] ?? 0),
  );
}

/**
 * `dry` in a synthetic room: convolved with an impulse response of a direct
 * sound of 1 and, from 0.5 ms, a velvet-noise tail (H. Järveläinen and M.
 * Karjalainen, "Reverberation Modeling Using Velvet Noise", AES 30th
 * International Conference, 2007): one tap of either sign, by `seed`, in each
 * 0.5 ms, of magnitude `0.15 · 10^(−3t / RT60)` at `t` seconds, falling 60 dB
 * every `rt60` seconds, to a length of `1.5 · rt60`.
 */
export function inRoom(dry: Float32Array, seed: number, rt60: number): Float32Array {
  const spacing = TEST_RATE / 2_000;
  const length = Math.floor(1.5 * rt60 * TEST_RATE);
  const random = noise(seed, { length: 2 * (length / spacing + 1), amplitude: 1 }).channels[0];
  const taps = [0];
  const gains = [1];
  for (let slot = 1; slot * spacing < length; slot += 1) {
    const place = random?.[2 * slot] ?? 0;
    const at = slot * spacing + Math.floor((place * 0.5 + 0.5) * (spacing - 1));
    taps.push(at);
    gains.push(
      ((random?.[2 * slot + 1] ?? 0) < 0 ? -0.15 : 0.15) * 10 ** ((-3 * at) / (rt60 * TEST_RATE)),
    );
  }
  const wet = new Float64Array(dry.length);
  for (const [tap, at] of taps.entries()) {
    const gain = gains[tap] ?? 0;
    for (let frame = at; frame < dry.length; frame += 1) {
      wet[frame] = (wet[frame] ?? 0) + gain * (dry[frame - at] ?? 0);
    }
  }
  return Float32Array.from(wet);
}

/**
 * The late reverberation of a signal of {@link bursts} from frame `from`, in
 * decibels: the energy of each silence between the bursts from 50 ms after a
 * burst ends, against the energy of the bursts.
 */
export function lateEnergyRatio(signal: Float32Array, from: number): number {
  let [late, bursting] = [0, 0];
  for (let frame = from; frame < signal.length; frame += 1) {
    const into = frame % (PERIOD * TEST_RATE);
    const energy = (signal[frame] ?? 0) ** 2;
    if (into < ON * TEST_RATE) bursting += energy;
    else if (into >= (ON + 0.05) * TEST_RATE) late += energy;
  }
  return 10 * Math.log10(late / bursting);
}

/** A second of each channel's own noise, a profile's stretch. */
export function noiseOf(
  layout: ChannelLayout,
  amplitude = 0.1,
  length: number = TEST_RATE,
): Float32Array[] {
  return layout.roles.map(
    (_, channel) => noise(40 + channel, { length, amplitude }).channels[0] ?? new Float32Array(0),
  );
}
