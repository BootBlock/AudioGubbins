/**
 * Filter: one low-pass, high-pass, band-pass, notch or all-pass filter, of
 * 12, 24, 36 or 48 dB per octave, with a resonance.
 *
 * A slope of `6n` dB per octave is a cascade of `n/2` sections at the cutoff.
 * For a low-pass or a high-pass the cascade is a Butterworth filter of order
 * `n`, each section with its pole pair's Q, maximally flat; the resonance is
 * the Q of the last section, the one that peaks, written as the Q of the 12 dB
 * filter it would be: the last section takes its Butterworth Q times the
 * resonance over `1/√2`, so `1/√2` is maximally flat at every slope, and at 12
 * dB per octave the resonance is the section's Q itself. A band-pass, a notch
 * or an all-pass is `n/2` like sections of the resonance's Q, each section
 * narrowing the skirts of the one before.
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
import type { NodeKernel } from '@audiogubbins/audio-engine';

import { processorType, type ProcessorRun } from '../framework/processor-type.js';
import { BiquadCascade, butterworthQ, sectionDecayFrames } from './biquad.js';
import { BiquadShape, SectionSetting } from './biquad-shape.js';
import { CascadeKernel, type CascadeDesigner } from './cascade-kernel.js';
import { choiceOf, numberOf } from './parameter-values.js';
import { RampedParameter } from './ramped-parameter.js';

const TYPE = 'filter';

/** Each mode's option key and the shape of its sections. */
const MODES: Readonly<Record<string, BiquadShape>> = {
  'low-pass': BiquadShape.LowPass,
  'high-pass': BiquadShape.HighPass,
  'band-pass': BiquadShape.BandPass,
  notch: BiquadShape.Notch,
  'all-pass': BiquadShape.AllPass,
};

/** Each slope's option key and the order of its filter, two per section. */
const ORDERS: Readonly<Record<string, number>> = {
  '12-db': 2,
  '24-db': 4,
  '36-db': 6,
  '48-db': 8,
};

/** The resonance at which the cascade is maximally flat: the Q of a 12 dB Butterworth filter. */
const FLAT_RESONANCE = Math.SQRT1_2;

const mode: ChoiceParameterDescriptor = {
  kind: 'choice',
  id: unsafeBrandId<'ParameterId'>('a1000000-0041'),
  key: 'mode',
  label: 'Mode',
  options: [
    { key: 'low-pass', label: 'Low-pass' },
    { key: 'high-pass', label: 'High-pass' },
    { key: 'band-pass', label: 'Band-pass' },
    { key: 'notch', label: 'Notch' },
    { key: 'all-pass', label: 'All-pass' },
  ],
  defaultKey: 'low-pass',
};

const cutoff: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('a1000000-0042'),
  key: 'cutoff',
  label: 'Cutoff',
  minimum: 20,
  maximum: 20_000,
  defaultValue: 1_000,
  taper: ParameterTaper.Logarithmic,
  unit: 'Hz',
};

const slope: ChoiceParameterDescriptor = {
  kind: 'choice',
  id: unsafeBrandId<'ParameterId'>('a1000000-0043'),
  key: 'slope',
  label: 'Slope',
  options: [
    { key: '12-db', label: '12 dB per octave' },
    { key: '24-db', label: '24 dB per octave' },
    { key: '36-db', label: '36 dB per octave' },
    { key: '48-db', label: '48 dB per octave' },
  ],
  defaultKey: '12-db',
};

const resonance: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('a1000000-0044'),
  key: 'resonance',
  label: 'Resonance',
  minimum: 0.1,
  maximum: 24,
  defaultValue: FLAT_RESONANCE,
  taper: ParameterTaper.Logarithmic,
  step: 0.01,
};

/** The shape and order a mode and a slope make. */
interface FilterShape {
  readonly shape: BiquadShape;
  readonly order: number;
}

function filterShape(modeKey: string, slopeKey: string): FilterShape {
  return { shape: MODES[modeKey] ?? BiquadShape.LowPass, order: ORDERS[slopeKey] ?? 2 };
}

/** The Butterworth Q of each section of `filter`'s order. */
function butterworthQs(filter: FilterShape): Float64Array {
  return Float64Array.from({ length: filter.order / 2 }, (_, section) =>
    butterworthQ(filter.order, section),
  );
}

/**
 * Replaces the resonance's Q in `qs[0]` with the Q of each section of
 * `filter` at it, section by section, given each section's Butterworth Q in
 * `butterworths`. Written into an array, as a running filter works it out
 * on the audio thread, where a Q returned from a call would be boxed.
 */
function sectionQs(filter: FilterShape, butterworths: Float64Array, qs: Float64Array): void {
  const resonanceQ = qs[0] ?? FLAT_RESONANCE;
  const butterworthShape =
    filter.shape === BiquadShape.LowPass || filter.shape === BiquadShape.HighPass;
  const last = qs.length - 1;
  for (let section = 0; section < qs.length; section += 1) {
    const butterworth = butterworths[section] ?? 0;
    if (!butterworthShape) qs[section] = resonanceQ;
    else if (section === last) qs[section] = (butterworth * resonanceQ) / FLAT_RESONANCE;
    else qs[section] = butterworth;
  }
}

/** Designs every section again whenever the cutoff or the resonance moved. */
class FilterDesigner implements CascadeDesigner {
  readonly ramps: readonly RampedParameter[];
  readonly #filter: FilterShape;
  readonly #rate: number;
  readonly #cutoff: RampedParameter;
  readonly #resonance: RampedParameter;
  readonly #butterworths: Float64Array;
  /** Each section's Q at the resonance last designed. */
  readonly #qs: Float64Array;

  constructor(filter: FilterShape, run: ProcessorRun) {
    const ramp = (parameter: NumericParameterDescriptor) =>
      new RampedParameter(
        parameter,
        run.parameters.number(parameter.key),
        run.sampleRate,
        run.blockFrames,
      );
    this.#filter = filter;
    this.#rate = run.sampleRate;
    this.#cutoff = ramp(cutoff);
    this.#resonance = ramp(resonance);
    this.ramps = [this.#cutoff, this.#resonance];
    this.#butterworths = butterworthQs(filter);
    this.#qs = new Float64Array(filter.order / 2);
  }

  design(cascade: BiquadCascade, frame: number): void {
    const moved = this.#cutoff.moved(frame);
    if (!this.#resonance.moved(frame) && !moved) return;
    const qs = this.#qs;
    qs[0] = this.#resonance.values[frame] ?? 0;
    sectionQs(this.#filter, this.#butterworths, qs);
    const settings = cascade.settings;
    settings[SectionSetting.Frequency] = this.#cutoff.values[frame] ?? 0;
    settings[SectionSetting.Gain] = 0;
    for (let section = 0; section < cascade.sections; section += 1) {
      settings[SectionSetting.Q] = qs[section] ?? 0;
      cascade.designSection(section, this.#filter.shape, this.#rate);
    }
  }
}

function kernel(run: ProcessorRun): DomainResult<NodeKernel> {
  const filter = filterShape(run.parameters.choice(mode.key), run.parameters.choice(slope.key));
  const cascade = new BiquadCascade(run.input.roles.length, filter.order / 2);
  return succeed(new CascadeKernel(TYPE, cascade, new FilterDesigner(filter, run)));
}

/** Frames for every section's response to decay by 120 dB, one after another. */
function leadIn({ values, sampleRate }: ProcessorSettings): number {
  const filter = filterShape(choiceOf(values, mode), choiceOf(values, slope));
  const frequency = numberOf(values, cutoff);
  const qs = new Float64Array(filter.order / 2);
  qs[0] = numberOf(values, resonance);
  sectionQs(filter, butterworthQs(filter), qs);
  let frames = 0;
  for (const sectionQ of qs) {
    frames += sectionDecayFrames(filter.shape, frequency, sampleRate, 0, sectionQ);
  }
  return frames;
}

/** Filter, as a processor of the rack. */
export const FILTER = processorType({
  descriptor: {
    typeKey: TYPE,
    label: 'Filter',
    category: ProcessorCategory.Equalisation,
    version: { implementation: 1, parameters: 1 },
    parameters: [mode, cutoff, slope, resonance],
    qualitySettings: [],
    determinism: DeterminismClass.Canonical,
    wholePass: false,
    realTime: true,
    // Each channel is filtered alike and apart, so any layout is kept as it is.
    outputLayout: (input) => succeed(input),
    latency: () => ({ kind: 'known', frames: ZERO_SAMPLES }),
    leadIn,
    frameGrid: () => 1,
  },
  kernel,
});
