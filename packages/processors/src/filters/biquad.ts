/**
 * The second-order section every filter and equaliser here is built from:
 * the designs of Robert Bristow-Johnson's "Audio EQ Cookbook", a cascade of
 * them run in transposed direct form II, and the Butterworth cascades that
 * give the steeper slopes. The designs are the cookbook's (`cookbook.ts`)
 * up to {@link HANDOVER_START} of the rate, and from there fitted to the
 * magnitude (`magnitude-fit.ts`), handing over from the cookbook's to the
 * analogue prototype's by {@link HIGHEST_DESIGN_FRACTION}, above which the
 * cookbook cannot place a section.
 */

import { cosineOfTurns, decibelsToGain, ln } from '@audiogubbins/audio-engine';

import { belowSilence, finiteSample } from '../framework/sample-safety.js';
import {
  BiquadShape,
  HANDOVER_START,
  HIGHEST_DESIGN_FRACTION,
  SectionSetting,
  prototypeShare,
} from './biquad-shape.js';
import { designCookbook } from './cookbook.js';
import { designFitted } from './magnitude-fit.js';

/** The coefficients of one section: b0, b1, b2, a1 and a2, each divided by a0. */
const COEFFICIENTS_PER_SECTION = 5;

/**
 * The frequency a first-order design's analogue estimate is taken at for
 * `frequency` at `rate`: no higher than the cookbook places a section, for a
 * design that has no fitted form (the DC-offset filter, whose cutoff is
 * never near it) and for the decay of a pole pair below it.
 */
export function designFrequency(frequency: number, rate: number): number {
  return Math.min(frequency, HIGHEST_DESIGN_FRACTION * rate);
}

/** The two designs a section in the hand-over is made between, and the fitted design's share. */
const HANDOVER = new Float64Array(2 * COEFFICIENTS_PER_SECTION);
const SHARE = new Float64Array(1);

/**
 * Writes the coefficients of `shape` at `rate`, at the frequency in Hz, gain
 * in dB and Q in `settings`, into `into` from `at`: the cookbook's exact
 * design up to {@link HANDOVER_START} of the rate, the design fitted to the
 * analogue magnitude from {@link HIGHEST_DESIGN_FRACTION} on, and between,
 * each coefficient moved from the one to the other in proportion to the
 * frequency, so a section's response has no step as its frequency crosses
 * either. Every stable denominator lies in one triangle of `a1` and `a2`,
 * which holds every point between two of its points, so each design between
 * is stable too.
 */
function designBiquad(
  shape: BiquadShape,
  rate: number,
  settings: Float64Array,
  into: Float64Array,
  at: number,
): void {
  prototypeShare(rate, settings, SHARE, 0);
  const share = SHARE[0] ?? 0;
  if (share === 0) {
    designCookbook(shape, rate, settings, into, at);
    return;
  }
  if (share === 1) {
    designFitted(shape, rate, settings, into, at);
    return;
  }
  designCookbook(shape, rate, settings, HANDOVER, 0);
  designFitted(shape, rate, settings, HANDOVER, COEFFICIENTS_PER_SECTION);
  for (let index = 0; index < COEFFICIENTS_PER_SECTION; index += 1) {
    into[at + index] =
      (1 - share) * (HANDOVER[index] ?? 0) +
      share * (HANDOVER[COEFFICIENTS_PER_SECTION + index] ?? 0);
  }
}

/**
 * The Q of section `section` of a Butterworth filter of `order`, an even
 * order made of `order / 2` sections: `1 / (2 cos θ)`, where θ, the angle of
 * the section's pole pair from the negative real axis, is `(2k + 1)π / 2n`,
 * `(2k + 1) / 4n` of a turn. The sections rise in Q, so the last is the one
 * that peaks.
 */
export function butterworthQ(order: number, section: number): number {
  return 1 / (2 * cosineOfTurns((2 * section + 1) / (4 * order)));
}

/** `ln 10⁶`: the time constants an exponential decay takes to fall by 120 dB. */
const TIME_CONSTANTS_TO_SILENCE = 13.815510557964274;

/**
 * The margin an estimate of decay is given over the analogue time constant:
 * the bilinear transform moves a digital filter's poles a little from its
 * prototype's, and a response's peak can sit below the envelope it decays
 * from, each of which leaves the true −120 dB point a few frames later.
 */
const DECAY_MARGIN = 1.25;

/** Frames an exponential decay of `timeConstant` seconds takes to fall by 120 dB at `rate`. */
export function silenceFrames(timeConstant: number, rate: number): number {
  return Math.ceil(DECAY_MARGIN * TIME_CONSTANTS_TO_SILENCE * timeConstant * rate);
}

/**
 * Frames an analogue pole pair of `frequency` and `poleQ` takes to decay by
 * 120 dB at `rate`, the estimate a lead-in is made from. The slower pole of
 * the pair decays at `ω₀ · σ`, where σ is `1/2Q` for a pair that rings, and
 * `1/2Q − √(1/4Q² − 1)` for one too damped to.
 */
export function poleDecayFrames(frequency: number, poleQ: number, rate: number): number {
  const half = 1 / (2 * poleQ);
  const beyond = half * half - 1;
  const damping = beyond > 0 ? half - Math.sqrt(beyond) : half;
  return silenceFrames(1 / (2 * Math.PI * designFrequency(frequency, rate) * damping), rate);
}

/** Where {@link fittedDecayFrames} designs the section it measures. */
const MEASURED = new Float64Array(COEFFICIENTS_PER_SECTION);
const MEASURED_SETTINGS = new Float64Array(3);

/**
 * Frames a fitted section takes to decay by 120 dB: from its own poles, whose
 * larger radius `r` falls by 120 dB in `ln 10⁶ / −ln r` frames, with the
 * margin the analogue estimate has, since a fitted section's poles are not
 * its prototype's.
 */
function fittedDecayFrames(
  shape: BiquadShape,
  frequency: number,
  rate: number,
  gain: number,
  q: number,
): number {
  MEASURED_SETTINGS[SectionSetting.Frequency] = frequency;
  MEASURED_SETTINGS[SectionSetting.Gain] = gain;
  MEASURED_SETTINGS[SectionSetting.Q] = q;
  designBiquad(shape, rate, MEASURED_SETTINGS, MEASURED, 0);
  const a1 = MEASURED[3] ?? 0;
  const a2 = MEASURED[4] ?? 0;
  const discriminant = a1 * a1 - 4 * a2;
  const radius = discriminant < 0 ? Math.sqrt(a2) : (Math.abs(a1) + Math.sqrt(discriminant)) / 2;
  if (radius === 0) return 0;
  return Math.ceil((DECAY_MARGIN * TIME_CONSTANTS_TO_SILENCE) / -ln(radius));
}

/**
 * Frames a section of `shape` takes to decay by 120 dB, from the poles of its
 * analogue prototype: a peaking section's have the Q `A·Q`, a low shelf's lie
 * at `f/√A` and a high shelf's at `f·√A`, each with the Q of the slope S = 1,
 * `1/√2`, and every other shape's are at `f` with the Q asked for. A fitted
 * section's are measured from its own poles.
 */
export function sectionDecayFrames(
  shape: BiquadShape,
  frequency: number,
  rate: number,
  gain: number,
  q: number,
): number {
  if (frequency > HANDOVER_START * rate) {
    return fittedDecayFrames(shape, frequency, rate, gain, q);
  }
  const amplitude = decibelsToGain(gain / 2);
  switch (shape) {
    case BiquadShape.Peaking:
      return poleDecayFrames(frequency, amplitude * q, rate);
    case BiquadShape.LowShelf:
      return poleDecayFrames(frequency / Math.sqrt(amplitude), Math.SQRT1_2, rate);
    case BiquadShape.HighShelf:
      return poleDecayFrames(frequency * Math.sqrt(amplitude), Math.SQRT1_2, rate);
    default:
      return poleDecayFrames(frequency, q, rate);
  }
}

/**
 * A cascade of sections run over each channel alike, each channel with its own
 * state. A sample passes every section in order in f64, each in transposed
 * direct form II: `y = b0·x + s1`, then `s1 = (b1·x − a1·y) + s2` and
 * `s2 = b2·x − a2·y`. A section's two states are flushed to zero together, once
 * both are below silence: one flushed alone is an error put into the other,
 * which a narrow resonance near DC raised back above the floor every time, so
 * its tail never fell silent.
 */
export class BiquadCascade {
  readonly sections: number;
  /** Each section's coefficients, {@link COEFFICIENTS_PER_SECTION} apiece; identity until set. */
  readonly coefficients: Float64Array;
  /**
   * What {@link designSection} designs a section from, by
   * {@link SectionSetting}: a designer on the audio thread writes it rather
   * than handing the numbers to a call, which would box each one wherever the
   * call was not inlined.
   */
  readonly settings = new Float64Array(3);
  /** Each channel's two states for each section, channel by channel. */
  readonly #state: Float64Array;

  constructor(channels: number, sections: number) {
    this.sections = sections;
    this.coefficients = new Float64Array(sections * COEFFICIENTS_PER_SECTION);
    for (let section = 0; section < sections; section += 1) {
      this.coefficients[section * COEFFICIENTS_PER_SECTION] = 1;
    }
    this.#state = new Float64Array(channels * sections * 2);
  }

  /** Designs section `section` of `shape` at `frequency` Hz, `gain` dB and `q`, at `rate`. */
  design(
    section: number,
    shape: BiquadShape,
    frequency: number,
    rate: number,
    gain: number,
    q: number,
  ): void {
    const settings = this.settings;
    settings[SectionSetting.Frequency] = frequency;
    settings[SectionSetting.Gain] = gain;
    settings[SectionSetting.Q] = q;
    this.designSection(section, shape, rate);
  }

  /** Designs section `section` of `shape` at `rate` from {@link settings}. */
  designSection(section: number, shape: BiquadShape, rate: number): void {
    designBiquad(shape, rate, this.settings, this.coefficients, section * COEFFICIENTS_PER_SECTION);
  }

  /**
   * Runs `count` frames of `channel`'s `input`, from `from`, through every
   * section, read through `finiteSample`, writing them to `output` from `at`.
   */
  run(
    channel: number,
    input: Float32Array,
    from: number,
    count: number,
    output: Float64Array,
    at: number,
  ): void {
    const c = this.coefficients;
    const state = this.#state;
    const base = channel * this.sections * 2;
    for (let frame = 0; frame < count; frame += 1) {
      let x = finiteSample(input[from + frame] ?? 0);
      for (let section = 0; section < this.sections; section += 1) {
        const k = section * COEFFICIENTS_PER_SECTION;
        const s = base + section * 2;
        const y = (c[k] ?? 0) * x + (state[s] ?? 0);
        const first = (c[k + 1] ?? 0) * x - (c[k + 3] ?? 0) * y + (state[s + 1] ?? 0);
        const second = (c[k + 2] ?? 0) * x - (c[k + 4] ?? 0) * y;
        const silent = belowSilence(first) && belowSilence(second);
        state[s] = silent ? 0 : first;
        state[s + 1] = silent ? 0 : second;
        x = y;
      }
      output[at + frame] = x;
    }
  }
}
