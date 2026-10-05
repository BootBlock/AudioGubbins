/**
 * The second-order section every filter and equaliser here is built from:
 * the designs of Robert Bristow-Johnson's "Audio EQ Cookbook", a cascade of
 * them run in transposed direct form II, and the Butterworth cascades that
 * give the steeper slopes.
 *
 * A design reads the angle of its frequency in turns through the canonical
 * cosine and sine, and the cookbook's `A`, `10^(dB/40)`, as the canonical
 * conversion of half the decibels, so a design is the same bits on every
 * machine (ADR-0032). Its six raw coefficients are each divided by `a0`, one
 * division apiece in the order b0, b1, b2, a1, a2, rather than multiplied by
 * a reciprocal, which would round twice.
 */

import { cosineOfTurns, decibelsToGain, sineOfTurns } from '@audiogubbins/audio-engine';

import { finiteSample, flushSubnormal } from '../framework/sample-safety.js';

/** The shapes a section can take, each a design of the cookbook. */
export const BiquadShape = {
  Peaking: 'peaking',
  LowShelf: 'low-shelf',
  HighShelf: 'high-shelf',
  LowPass: 'low-pass',
  HighPass: 'high-pass',
  BandPass: 'band-pass',
  Notch: 'notch',
  AllPass: 'all-pass',
} as const;

/** A shape a section can take. */
export type BiquadShape = (typeof BiquadShape)[keyof typeof BiquadShape];

/** The coefficients of one section: b0, b1, b2, a1 and a2, each divided by a0. */
const COEFFICIENTS_PER_SECTION = 5;

/**
 * The highest frequency a design is made at, as a fraction of the rate. At half
 * the rate the sine of the angle is zero, so `α` is zero and the poles of a
 * low-pass reach the unit circle; and a frequency a person set above half a low
 * rate, 20 kHz at 32 kHz, has no place in its spectrum. Just below half the
 * rate every design stays stable and as near to what was asked as the rate
 * allows.
 */
export const HIGHEST_DESIGN_FRACTION = 0.49;

/** The frequency a design is made at for `frequency` at `rate`. */
export function designFrequency(frequency: number, rate: number): number {
  return Math.min(frequency, HIGHEST_DESIGN_FRACTION * rate);
}

/**
 * Where a design takes what it is made from and leaves its raw coefficients. V8
 * boxes a double passed to or returned from a call it does not inline, and a
 * running filter designs its sections again as its parameters move, on the
 * audio thread, so a design's steps return nothing and hand their doubles
 * through here: first `cos ω₀`, `α`, the cookbook's `A` (`10^(dB/40)`) and
 * `2·√A·α`, which the shelves alone take, then the raw b0, b1, b2, a0, a1 and
 * a2, before division by a0. Each step reads what it is given as it starts and
 * writes its answer as it ends.
 */
const SLOT = new Float64Array(6);

/** Replaces what a shape's design is made from in {@link SLOT} with its raw coefficients. */
type Design = () => void;

/** Each shape's raw coefficients, in the cookbook's order of terms. */
const DESIGNS: Readonly<Record<BiquadShape, Design>> = {
  [BiquadShape.Peaking]: () => {
    const cosine = SLOT[0] ?? 0;
    const alpha = SLOT[1] ?? 0;
    const a = SLOT[2] ?? 0;
    SLOT[0] = 1 + alpha * a;
    SLOT[1] = -2 * cosine;
    SLOT[2] = 1 - alpha * a;
    SLOT[3] = 1 + alpha / a;
    SLOT[4] = -2 * cosine;
    SLOT[5] = 1 - alpha / a;
  },
  [BiquadShape.LowShelf]: () => {
    const cosine = SLOT[0] ?? 0;
    const a = SLOT[2] ?? 0;
    const shelf = SLOT[3] ?? 0;
    SLOT[0] = a * (a + 1 - (a - 1) * cosine + shelf);
    SLOT[1] = 2 * a * (a - 1 - (a + 1) * cosine);
    SLOT[2] = a * (a + 1 - (a - 1) * cosine - shelf);
    SLOT[3] = a + 1 + (a - 1) * cosine + shelf;
    SLOT[4] = -2 * (a - 1 + (a + 1) * cosine);
    SLOT[5] = a + 1 + (a - 1) * cosine - shelf;
  },
  [BiquadShape.HighShelf]: () => {
    const cosine = SLOT[0] ?? 0;
    const a = SLOT[2] ?? 0;
    const shelf = SLOT[3] ?? 0;
    SLOT[0] = a * (a + 1 + (a - 1) * cosine + shelf);
    SLOT[1] = -2 * a * (a - 1 + (a + 1) * cosine);
    SLOT[2] = a * (a + 1 + (a - 1) * cosine - shelf);
    SLOT[3] = a + 1 - (a - 1) * cosine + shelf;
    SLOT[4] = 2 * (a - 1 - (a + 1) * cosine);
    SLOT[5] = a + 1 - (a - 1) * cosine - shelf;
  },
  [BiquadShape.LowPass]: () => {
    const cosine = SLOT[0] ?? 0;
    const alpha = SLOT[1] ?? 0;
    SLOT[0] = (1 - cosine) / 2;
    SLOT[1] = 1 - cosine;
    SLOT[2] = (1 - cosine) / 2;
    SLOT[3] = 1 + alpha;
    SLOT[4] = -2 * cosine;
    SLOT[5] = 1 - alpha;
  },
  [BiquadShape.HighPass]: () => {
    const cosine = SLOT[0] ?? 0;
    const alpha = SLOT[1] ?? 0;
    SLOT[0] = (1 + cosine) / 2;
    SLOT[1] = -(1 + cosine);
    SLOT[2] = (1 + cosine) / 2;
    SLOT[3] = 1 + alpha;
    SLOT[4] = -2 * cosine;
    SLOT[5] = 1 - alpha;
  },
  [BiquadShape.BandPass]: () => {
    const cosine = SLOT[0] ?? 0;
    const alpha = SLOT[1] ?? 0;
    SLOT[0] = alpha;
    SLOT[1] = 0;
    SLOT[2] = -alpha;
    SLOT[3] = 1 + alpha;
    SLOT[4] = -2 * cosine;
    SLOT[5] = 1 - alpha;
  },
  [BiquadShape.Notch]: () => {
    const cosine = SLOT[0] ?? 0;
    const alpha = SLOT[1] ?? 0;
    SLOT[0] = 1;
    SLOT[1] = -2 * cosine;
    SLOT[2] = 1;
    SLOT[3] = 1 + alpha;
    SLOT[4] = -2 * cosine;
    SLOT[5] = 1 - alpha;
  },
  [BiquadShape.AllPass]: () => {
    const cosine = SLOT[0] ?? 0;
    const alpha = SLOT[1] ?? 0;
    SLOT[0] = 1 - alpha;
    SLOT[1] = -2 * cosine;
    SLOT[2] = 1 + alpha;
    SLOT[3] = 1 + alpha;
    SLOT[4] = -2 * cosine;
    SLOT[5] = 1 - alpha;
  },
};

/**
 * The shelves' slope, S = 1, the steepest that does not overshoot, which
 * makes their `α` `sin(ω₀)/2 · √2` whatever their gain.
 */
const SHELF_ALPHA_FACTOR = Math.SQRT2 / 2;

/** Where each of a section's settings is in a cascade's {@link BiquadCascade.settings}. */
export const SectionSetting = { Frequency: 0, Gain: 1, Q: 2 } as const;

/**
 * Writes the coefficients of `shape` at `rate`, at the frequency in Hz, gain
 * in dB and Q in `settings`, into `into` from `at`. The gain is read by the
 * peaking and shelf shapes alone, and the Q by every shape but the shelves.
 */
function designBiquad(
  shape: BiquadShape,
  rate: number,
  settings: Float64Array,
  into: Float64Array,
  at: number,
): void {
  const turns = designFrequency(settings[SectionSetting.Frequency] ?? 0, rate) / rate;
  const sine = sineOfTurns(turns);
  const shelved = shape === BiquadShape.LowShelf || shape === BiquadShape.HighShelf;
  const alpha = shelved
    ? sine * SHELF_ALPHA_FACTOR
    : sine / (2 * (settings[SectionSetting.Q] ?? 0));
  const amplitude = decibelsToGain((settings[SectionSetting.Gain] ?? 0) / 2);
  SLOT[0] = cosineOfTurns(turns);
  SLOT[1] = alpha;
  SLOT[2] = amplitude;
  SLOT[3] = shelved ? 2 * Math.sqrt(amplitude) * alpha : 0;
  DESIGNS[shape]();
  const a0 = SLOT[3];
  into[at] = SLOT[0] / a0;
  into[at + 1] = SLOT[1] / a0;
  into[at + 2] = SLOT[2] / a0;
  into[at + 3] = (SLOT[4] ?? 0) / a0;
  into[at + 4] = (SLOT[5] ?? 0) / a0;
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

/**
 * Frames a section of `shape` takes to decay by 120 dB, from the poles of its
 * analogue prototype: a peaking section's have the Q `A·Q`, a low shelf's lie
 * at `f/√A` and a high shelf's at `f·√A`, each with the Q of the slope S = 1,
 * `1/√2`, and every other shape's are at `f` with the Q asked for.
 */
export function sectionDecayFrames(
  shape: BiquadShape,
  frequency: number,
  rate: number,
  gain: number,
  q: number,
): number {
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
 * A cascade of sections run over each channel alike, each channel with its
 * own state. A sample passes every section in order in f64, each in
 * transposed direct form II: `y = b0·x + s1`, then `s1 = (b1·x − a1·y) + s2`
 * and `s2 = b2·x − a2·y`, each state through `flushSubnormal`.
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
        state[s] = flushSubnormal((c[k + 1] ?? 0) * x - (c[k + 3] ?? 0) * y + (state[s + 1] ?? 0));
        state[s + 1] = flushSubnormal((c[k + 2] ?? 0) * x - (c[k + 4] ?? 0) * y);
        x = y;
      }
      output[at + frame] = x;
    }
  }
}
