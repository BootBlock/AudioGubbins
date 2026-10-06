/**
 * De-hum: a notch at the mains frequency and at each of its first harmonics,
 * taking out the hum of a ground loop and its buzz.
 *
 * The fundamental is 50 or 60 Hz, moved by up to 2 Hz each way for a supply
 * or a recording off its nominal speed; harmonic `k`, from 1, the fundamental
 * itself, to the number asked for, is notched at `k` times it, each with the
 * same Q, so each notch spans the same fraction of its frequency. A harmonic
 * at or past the highest frequency a design is made at is left out, rather
 * than notched at a frequency it is not at.
 *
 * At a depth of 60 dB a notch is the cookbook's, a zero on the unit circle.
 * Below it a notch is partial: `(s² + s·g/Q + 1) / (s² + s/Q + 1)`, whose poles
 * are the full notch's and whose zeros leave `g`, the depth's gain, at the
 * centre, so a deeper setting narrows nothing and a shallower one widens
 * nothing. That is the cookbook's peaking section with a gain of minus the
 * depth and a Q of `Q / A`, `A` being `10^(−depth/40)`.
 */

import {
  DeterminismClass,
  ParameterTaper,
  ProcessorCategory,
  ZERO_SAMPLES,
  succeed,
  unsafeBrandId,
  type ChoiceParameterDescriptor,
  type DomainResult,
  type NumericParameterDescriptor,
  type ProcessorSettings,
} from '@audiogubbins/domain';
import { decibelsToGain, type NodeKernel } from '@audiogubbins/audio-engine';

import { processorType, type ProcessorRun } from '../framework/processor-type.js';
import {
  BiquadCascade,
  BiquadShape,
  HIGHEST_DESIGN_FRACTION,
  SectionSetting,
  poleDecayFrames,
} from './biquad.js';
import { CascadeKernel, type CascadeDesigner } from './cascade-kernel.js';
import { choiceOf, numberOf } from './parameter-values.js';
import { RampedParameter } from './ramped-parameter.js';

const TYPE = 'de-hum';

/** The depth at which a notch is full rather than partial. */
const FULL_DEPTH = 60;

/** Each fundamental's option key and its nominal frequency. */
const FUNDAMENTALS: Readonly<Record<string, number>> = { '50-hz': 50, '60-hz': 60 };

const fundamental: ChoiceParameterDescriptor = {
  kind: 'choice',
  id: unsafeBrandId<'ParameterId'>('a1000000-0046'),
  key: 'fundamental',
  label: 'Fundamental',
  options: [
    { key: '50-hz', label: '50 Hz' },
    { key: '60-hz', label: '60 Hz' },
  ],
  defaultKey: '50-hz',
};

const offset: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('a1000000-0047'),
  key: 'offset',
  label: 'Fine offset',
  minimum: -2,
  maximum: 2,
  defaultValue: 0,
  taper: ParameterTaper.Linear,
  unit: 'Hz',
  step: 0.01,
};

const harmonics: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('a1000000-0048'),
  key: 'harmonics',
  label: 'Harmonics',
  minimum: 1,
  maximum: 12,
  defaultValue: 4,
  taper: ParameterTaper.Linear,
  step: 1,
};

const q: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('a1000000-0049'),
  key: 'q',
  label: 'Q',
  minimum: 5,
  maximum: 100,
  defaultValue: 30,
  taper: ParameterTaper.Logarithmic,
  step: 0.1,
};

const depth: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('a1000000-0050'),
  key: 'depth',
  label: 'Depth',
  minimum: 0,
  maximum: FULL_DEPTH,
  defaultValue: FULL_DEPTH,
  taper: ParameterTaper.Linear,
  unit: 'dB',
  step: 0.1,
};

/**
 * The notches made for `count` harmonics of `nominal` Hz at `rate`: the
 * harmonics, whole ones only, whose frequency at the highest offset is below
 * the highest a design is made at, so a moving offset never adds or drops one.
 */
function notchCount(nominal: number, count: number, rate: number): number {
  const top = nominal + offset.maximum;
  let kept = Math.floor(count);
  while (kept > 0 && kept * top >= HIGHEST_DESIGN_FRACTION * rate) kept -= 1;
  return kept;
}

/** Designs every notch again whenever the offset, the Q or the depth moved. */
class HumDesigner implements CascadeDesigner {
  readonly ramps: readonly RampedParameter[];
  readonly #nominal: number;
  readonly #rate: number;
  readonly #offset: RampedParameter;
  readonly #q: RampedParameter;
  readonly #depth: RampedParameter;

  constructor(run: ProcessorRun) {
    const ramp = (parameter: NumericParameterDescriptor) =>
      new RampedParameter(
        parameter,
        run.parameters.number(parameter.key),
        run.sampleRate,
        run.blockFrames,
      );
    this.#nominal = FUNDAMENTALS[run.parameters.choice(fundamental.key)] ?? 50;
    this.#rate = run.sampleRate;
    this.#offset = ramp(offset);
    this.#q = ramp(q);
    this.#depth = ramp(depth);
    this.ramps = [this.#offset, this.#q, this.#depth];
  }

  get nominal(): number {
    return this.#nominal;
  }

  design(cascade: BiquadCascade, frame: number): void {
    let moved = this.#offset.moved(frame);
    moved = this.#q.moved(frame) || moved;
    moved = this.#depth.moved(frame) || moved;
    if (moved) this.#designNotches(cascade, frame);
  }

  /**
   * Every notch at the offset, Q and depth at `frame`. Out of line, as a
   * moved parameter is too rare for V8 to inline a conversion called from the
   * branch it takes.
   */
  #designNotches(cascade: BiquadCascade, frame: number): void {
    const base = this.#nominal + (this.#offset.values[frame] ?? 0);
    const notchQ = this.#q.values[frame] ?? 0;
    const notchDepth = this.#depth.values[frame] ?? 0;
    const amplitude = decibelsToGain(-notchDepth / 2);
    const settings = cascade.settings;
    for (let section = 0; section < cascade.sections; section += 1) {
      settings[SectionSetting.Frequency] = base * (section + 1);
      if (notchDepth >= FULL_DEPTH) {
        settings[SectionSetting.Gain] = 0;
        settings[SectionSetting.Q] = notchQ;
        cascade.designSection(section, BiquadShape.Notch, this.#rate);
      } else {
        settings[SectionSetting.Gain] = -notchDepth;
        settings[SectionSetting.Q] = notchQ / amplitude;
        cascade.designSection(section, BiquadShape.Peaking, this.#rate);
      }
    }
  }
}

function kernel(run: ProcessorRun): DomainResult<NodeKernel> {
  const designer = new HumDesigner(run);
  const count = notchCount(designer.nominal, run.parameters.number(harmonics.key), run.sampleRate);
  const cascade = new BiquadCascade(run.input.roles.length, count);
  return succeed(new CascadeKernel(TYPE, cascade, designer));
}

/**
 * Frames for every notch to decay by 120 dB, one after another. A partial
 * notch has the full notch's poles, so every notch's estimate is that of a
 * pole pair of the Q asked for at its harmonic.
 */
function leadIn({ values, sampleRate }: ProcessorSettings): number {
  const nominal = FUNDAMENTALS[choiceOf(values, fundamental)] ?? 50;
  const base = nominal + numberOf(values, offset);
  const count = notchCount(nominal, numberOf(values, harmonics), sampleRate);
  let frames = 0;
  for (let harmonic = 1; harmonic <= count; harmonic += 1) {
    frames += poleDecayFrames(base * harmonic, numberOf(values, q), sampleRate);
  }
  return frames;
}

/** De-hum, as a processor of the rack. */
export const DE_HUM = processorType({
  descriptor: {
    typeKey: TYPE,
    label: 'De-hum',
    category: ProcessorCategory.Restoration,
    version: { implementation: 1, parameters: 1 },
    parameters: [fundamental, offset, harmonics, q, depth],
    qualitySettings: [],
    determinism: DeterminismClass.Canonical,
    wholePass: false,
    realTime: true,
    // Hum is in every channel alike, so each is notched alike and any layout is kept.
    outputLayout: (input) => succeed(input),
    latency: () => ({ kind: 'known', frames: ZERO_SAMPLES }),
    leadIn,
    frameGrid: () => 1,
  },
  kernel,
});
