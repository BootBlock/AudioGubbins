/**
 * Loops with known seams (`REQ-GAME-121`'s acceptance fixtures), generated
 * from their parameters so a golden result means the same audio on every
 * machine: every sine is the canonical `sineOfTurns` of an exactly reduced
 * argument, every decay the canonical `exp`, and every noise a 32-bit counter
 * hash, none of them a platform function.
 *
 * A fixture's boundaries are stated in seconds where its rate can vary, each
 * a whole number of its sine's periods, so the same loop exists at every rate
 * a sample-rate test takes.
 */

import { exp, memorySource, sineOfTurns, type PcmSource } from '@audiogubbins/audio-engine';
import {
  FadeShape,
  StandardLayouts,
  sampleRate,
  type ChannelLayout,
  type SampleRate,
} from '@audiogubbins/domain';

import type { AnalysedLoop } from '../loop-request.js';

/** A region's audio and the loop in it. */
export interface LoopFixture {
  readonly name: string;
  readonly sampleRate: SampleRate;
  readonly layout: ChannelLayout;
  /** The region's audio, one array per channel. */
  readonly channels: readonly Float32Array[];
  readonly loop: AnalysedLoop;
}

/** The rate a fixture uses unless it is asked for another. */
export const LOOP_FIXTURE_RATE = 48_000;

function rateOf(hertz: number): SampleRate {
  const rate = sampleRate(hertz);
  if (!rate.ok) throw new Error(`${String(hertz)} Hz is not a rate a fixture can take.`);
  return rate.value;
}

/** `amplitude · sin(2π · frequency · n / rate)` for `frames` frames from frame `first`, `frequency` whole hertz. */
function sine(
  frequency: number,
  rate: number,
  frames: number,
  amplitude: number,
  first = 0,
): Float32Array {
  const samples = new Float32Array(frames);
  for (let n = 0; n < frames; n += 1) {
    samples[n] = amplitude * sineOfTurns(((frequency * (first + n)) % rate) / rate);
  }
  return samples;
}

/** A uniform value in `[−1, 1)` for `index` of stream `seed`, by a 32-bit counter hash. */
function noiseAt(seed: number, index: number): number {
  let state = (Math.imul(index, 0x9e3779b1) ^ Math.imul(seed, 0x85ebca77)) >>> 0;
  state = Math.imul(state ^ (state >>> 16), 0x7feb352d) >>> 0;
  state = Math.imul(state ^ (state >>> 15), 0x846ca68b) >>> 0;
  state = (state ^ (state >>> 16)) >>> 0;
  return state / 2 ** 31 - 1;
}

function loopOf(start: number, end: number, crossfadeLength = 0): AnalysedLoop {
  return { start, end, crossfadeLength, crossfadeShape: FadeShape.EqualPower };
}

function mono(name: string, rate: number, samples: Float32Array, loop: AnalysedLoop): LoopFixture {
  return {
    name,
    sampleRate: rateOf(rate),
    layout: StandardLayouts.mono,
    channels: [samples],
    loop,
  };
}

/** Where a 480 Hz sine loop lies: 0.1 s in, 0.5 s long, 0.1 s after; whole periods at 44.1, 48 and 96 kHz. */
function sinePlace(rate: number): {
  readonly start: number;
  readonly end: number;
  readonly frames: number;
} {
  const start = Math.round(0.1 * rate);
  const end = start + Math.round(0.5 * rate);
  return { start, end, frames: end + Math.round(0.1 * rate) };
}

/** A 480 Hz sine looped at a whole number of periods inside a longer region: every metric passes. */
export function seamlessSine(rate = LOOP_FIXTURE_RATE): LoopFixture {
  const { start, end, frames } = sinePlace(rate);
  return mono('seamless-sine', rate, sine(480, rate, frames, 0.5), loopOf(start, end));
}

/** The same sine, its loop the whole region: the only reference is the loop's own tail and head. */
export function wholeSoundSine(rate = LOOP_FIXTURE_RATE): LoopFixture {
  const frames = Math.round(0.5 * rate);
  return mono('whole-sound-sine', rate, sine(480, rate, frames, 0.5), loopOf(0, frames));
}

/** The sine's loop cut a quarter period short: the head arrives 90° early. */
export function quarterPeriodShort(rate = LOOP_FIXTURE_RATE): LoopFixture {
  const { start, end, frames } = sinePlace(rate);
  return mono(
    'quarter-period-short',
    rate,
    sine(480, rate, frames, 0.5),
    loopOf(start, end - Math.round(rate / 480 / 4)),
  );
}

/** The sine with a DC step of 0.05 halfway through the loop, held after it: the head lacks the DC its successor has. */
export function dcStep(rate = LOOP_FIXTURE_RATE): LoopFixture {
  const { start, end, frames } = sinePlace(rate);
  const samples = sine(480, rate, frames, 0.5);
  const step = start + Math.round(0.25 * rate);
  for (let n = step; n < frames; n += 1) samples[n] = (samples[n] ?? 0) + 0.05;
  return mono('dc-step', rate, samples, loopOf(start, end));
}

/** The sine 6 dB louder from halfway through the loop on: the head is quieter than its successor. */
export function levelStep(rate = LOOP_FIXTURE_RATE): LoopFixture {
  const { start, end, frames } = sinePlace(rate);
  const samples = sine(480, rate, frames, 0.4);
  const step = start + Math.round(0.25 * rate);
  for (let n = step; n < frames; n += 1) samples[n] = (samples[n] ?? 0) * 2;
  return mono('level-step', rate, samples, loopOf(start, end));
}

/** A 55 Hz drone with a steady DC of 0.004, looped over a second of whole periods: its DC never mismatches. */
export function drone(rate = LOOP_FIXTURE_RATE): LoopFixture {
  const start = Math.round(0.2 * rate);
  const end = start + rate;
  const samples = sine(55, rate, end + Math.round(0.2 * rate), 0.6);
  for (let n = 0; n < samples.length; n += 1) samples[n] = (samples[n] ?? 0) + 0.004;
  return mono('drone', rate, samples, loopOf(start, end));
}

/**
 * Three identical half-second bars, each a kick (a 60 Hz sine falling away)
 * and a noise burst at its start, looped over the second bar: the head is a
 * hit after the tail's decay, as in the audio around it, so it is seamless.
 */
export function drumBars(rate = LOOP_FIXTURE_RATE): LoopFixture {
  const bar = Math.round(0.5 * rate);
  const samples = new Float32Array(3 * bar);
  for (let n = 0; n < bar; n += 1) {
    const seconds = n / rate;
    const kick = 0.6 * sineOfTurns(((60 * n) % rate) / rate) * exp(-seconds / 0.08);
    const burst = 0.25 * noiseAt(7, n) * exp(-seconds / 0.02);
    for (let copy = 0; copy < 3; copy += 1) samples[copy * bar + n] = kick + burst;
  }
  return mono('drum-bars', rate, samples, loopOf(bar, 2 * bar));
}

/**
 * Noise repeating every quarter second, its loop cut 37 frames late at the
 * start and 61 frames short of two repeats at the end: a search within 20 ms
 * finds whole repeats.
 */
export function cutNoise(rate = LOOP_FIXTURE_RATE): LoopFixture {
  const period = Math.round(0.25 * rate);
  const samples = new Float32Array(5 * period);
  for (let n = 0; n < samples.length; n += 1) samples[n] = 0.3 * noiseAt(11, n % period);
  const start = period + 37;
  return mono('cut-noise', rate, samples, loopOf(start, start + 2 * period - 61));
}

/** Stereo whose left channel is the seamless sine and whose right, at 485 Hz, is half a period out at the seam. */
export function rightChannelDiscontinuous(rate = LOOP_FIXTURE_RATE): LoopFixture {
  const { start, end, frames } = sinePlace(rate);
  return {
    name: 'right-channel-discontinuous',
    sampleRate: rateOf(rate),
    layout: StandardLayouts.stereo,
    channels: [sine(480, rate, frames, 0.5), sine(485, rate, frames, 0.5)],
    loop: loopOf(start, end),
  };
}

/** Stereo in anti-phase, its loop 23 frames past whole periods: anchors and correlation still find them. */
export function antiPhaseStereo(rate = LOOP_FIXTURE_RATE): LoopFixture {
  const { start, end, frames } = sinePlace(rate);
  const left = sine(480, rate, frames, 0.5);
  return {
    name: 'anti-phase-stereo',
    sampleRate: rateOf(rate),
    layout: StandardLayouts.stereo,
    channels: [left, left.map((sample) => -sample)],
    loop: loopOf(start, end + 23),
  };
}

/** The seamless sine with a click of 0.5 at the loop's last frame. */
export function clickBeforeSeam(rate = LOOP_FIXTURE_RATE): LoopFixture {
  const fixture = seamlessSine(rate);
  const [samples] = fixture.channels;
  const clicked = Float32Array.from(samples ?? []);
  clicked[fixture.loop.end - 1] = (clicked[fixture.loop.end - 1] ?? 0) + 0.5;
  return { ...fixture, name: 'click-before-seam', channels: [clicked] };
}

/** One period of a 480 Hz sine, 100 frames at 48 kHz, looped inside a longer region: read around itself. */
export function singleCycle(): LoopFixture {
  const samples = sine(480, LOOP_FIXTURE_RATE, 4_800, 0.5);
  return mono('single-cycle', LOOP_FIXTURE_RATE, samples, loopOf(1_000, 1_100));
}

/** Silence, looped. */
export function silentLoop(): LoopFixture {
  return mono('silence', LOOP_FIXTURE_RATE, new Float32Array(28_800), loopOf(4_800, 24_000));
}

/** A constant 0.25, looped: no zero crossing anywhere and a net DC of −12 dBFS. */
export function directCurrentOnly(): LoopFixture {
  return mono(
    'dc-only',
    LOOP_FIXTURE_RATE,
    new Float32Array(28_800).fill(0.25),
    loopOf(4_800, 24_000),
  );
}

/** The seamless sine with one sample that is not a number inside the loop. */
export function nonFinite(): LoopFixture {
  const fixture = seamlessSine();
  const [samples] = fixture.channels;
  const broken = Float32Array.from(samples ?? []);
  broken[fixture.loop.start + 500] = Number.NaN;
  return { ...fixture, name: 'non-finite', channels: [broken] };
}

/** A source over a fixture's region. */
export function fixtureSource(
  fixture: Pick<LoopFixture, 'layout' | 'sampleRate' | 'channels'>,
): PcmSource {
  const made = memorySource({
    layout: fixture.layout,
    sampleRate: fixture.sampleRate,
    frames: fixture.channels[0]?.length ?? 0,
    channels: fixture.channels,
  });
  if (!made.ok) throw new Error(made.failures[0].summary);
  return made.value;
}
