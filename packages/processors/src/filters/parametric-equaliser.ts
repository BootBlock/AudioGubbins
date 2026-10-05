/**
 * Parametric equaliser: eight bands, each a bell, a shelf, a cut, a notch or
 * a band-pass, run one after another over every channel alike.
 *
 * Each band that is on is one section of the cascade, in band order; a band
 * that is off is no section at all, so the default, every band off, passes
 * its input through untouched. A band's frequency, gain and Q may move while
 * it plays; whether it is on and its type make the cascade, so changing one
 * makes a new kernel. The shelves have the cookbook's slope S = 1 and take no
 * Q; a cut is a 12 dB per octave section whose Q is the band's; the gain is
 * read by the bell and the shelves alone.
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
  type ToggleParameterDescriptor,
} from '@audiogubbins/domain';
import type { NodeKernel } from '@audiogubbins/audio-engine';

import { processorType, type ProcessorRun } from '../framework/processor-type.js';
import { BiquadCascade, BiquadShape, SectionSetting, sectionDecayFrames } from './biquad.js';
import { CascadeKernel, type CascadeDesigner } from './cascade-kernel.js';
import { choiceOf, numberOf, toggleOf } from './parameter-values.js';
import { RampedParameter } from './ramped-parameter.js';

const TYPE = 'parametric-equaliser';

/** Each band type's option, in the order a menu lists them. */
const OPTIONS: ChoiceParameterDescriptor['options'] = [
  { key: 'bell', label: 'Bell' },
  { key: 'low-shelf', label: 'Low shelf' },
  { key: 'high-shelf', label: 'High shelf' },
  { key: 'low-cut', label: 'Low cut' },
  { key: 'high-cut', label: 'High cut' },
  { key: 'notch', label: 'Notch' },
  { key: 'band-pass', label: 'Band pass' },
];

/** Each band type's section: a cut keeps the frequencies on the far side of it. */
const SHAPES: Readonly<Record<string, BiquadShape>> = {
  bell: BiquadShape.Peaking,
  'low-shelf': BiquadShape.LowShelf,
  'high-shelf': BiquadShape.HighShelf,
  'low-cut': BiquadShape.HighPass,
  'high-cut': BiquadShape.LowPass,
  notch: BiquadShape.Notch,
  'band-pass': BiquadShape.BandPass,
};

function shapeOf(typeKey: string): BiquadShape {
  return SHAPES[typeKey] ?? BiquadShape.Peaking;
}

/** The parameters of one band. */
interface Band {
  readonly on: ToggleParameterDescriptor;
  readonly type: ChoiceParameterDescriptor;
  readonly frequency: NumericParameterDescriptor;
  readonly gain: NumericParameterDescriptor;
  readonly q: NumericParameterDescriptor;
}

/**
 * Each band's parameter identifiers, on, type, frequency, gain and Q, written
 * out once: an identifier is stored in every saved project, so it is never
 * computed.
 */
const BAND_IDS: readonly (readonly [string, string, string, string, string])[] = [
  ['a1000000-0001', 'a1000000-0002', 'a1000000-0003', 'a1000000-0004', 'a1000000-0005'],
  ['a1000000-0006', 'a1000000-0007', 'a1000000-0008', 'a1000000-0009', 'a1000000-0010'],
  ['a1000000-0011', 'a1000000-0012', 'a1000000-0013', 'a1000000-0014', 'a1000000-0015'],
  ['a1000000-0016', 'a1000000-0017', 'a1000000-0018', 'a1000000-0019', 'a1000000-0020'],
  ['a1000000-0021', 'a1000000-0022', 'a1000000-0023', 'a1000000-0024', 'a1000000-0025'],
  ['a1000000-0026', 'a1000000-0027', 'a1000000-0028', 'a1000000-0029', 'a1000000-0030'],
  ['a1000000-0031', 'a1000000-0032', 'a1000000-0033', 'a1000000-0034', 'a1000000-0035'],
  ['a1000000-0036', 'a1000000-0037', 'a1000000-0038', 'a1000000-0039', 'a1000000-0040'],
];

/**
 * Each band's type and frequency when it is first switched on, spread across
 * the spectrum as a console lays its bands out: a cut and a shelf at each end
 * and bells between.
 */
const BAND_DEFAULTS: readonly (readonly [string, number])[] = [
  ['low-cut', 30],
  ['low-shelf', 80],
  ['bell', 200],
  ['bell', 500],
  ['bell', 1_200],
  ['bell', 3_000],
  ['high-shelf', 8_000],
  ['high-cut', 18_000],
];

/** A numeric parameter of a band, from what is particular to it. */
function numeric(
  id: string | undefined,
  key: string,
  label: string,
  range: Pick<NumericParameterDescriptor, 'minimum' | 'maximum' | 'defaultValue' | 'taper'> &
    Partial<Pick<NumericParameterDescriptor, 'unit' | 'step'>>,
): NumericParameterDescriptor {
  return { kind: 'numeric', id: unsafeBrandId<'ParameterId'>(id ?? ''), key, label, ...range };
}

function band(index: number): Band {
  const [onId, typeId, frequencyId, gainId, qId] = BAND_IDS[index] ?? [];
  const [typeKey, frequency] = BAND_DEFAULTS[index] ?? ['bell', 1_000];
  const name = `band-${String(index + 1)}`;
  const label = `Band ${String(index + 1)}`;
  const cut = typeKey === 'low-cut' || typeKey === 'high-cut';
  return {
    on: {
      kind: 'toggle',
      id: unsafeBrandId<'ParameterId'>(onId ?? ''),
      key: `${name}-on`,
      label: `${label} on`,
      defaultValue: false,
    },
    type: {
      kind: 'choice',
      id: unsafeBrandId<'ParameterId'>(typeId ?? ''),
      key: `${name}-type`,
      label: `${label} type`,
      options: OPTIONS,
      defaultKey: typeKey,
    },
    frequency: numeric(frequencyId, `${name}-frequency`, `${label} frequency`, {
      minimum: 20,
      maximum: 20_000,
      defaultValue: frequency,
      taper: ParameterTaper.Logarithmic,
      unit: 'Hz',
    }),
    gain: numeric(gainId, `${name}-gain`, `${label} gain`, {
      minimum: -24,
      maximum: 24,
      defaultValue: 0,
      taper: ParameterTaper.Decibel,
      unit: 'dB',
      step: 0.1,
    }),
    q: numeric(qId, `${name}-q`, `${label} Q`, {
      minimum: 0.1,
      maximum: 24,
      defaultValue: cut ? Math.SQRT1_2 : 1,
      taper: ParameterTaper.Logarithmic,
      step: 0.01,
    }),
  };
}

const BANDS: readonly Band[] = BAND_IDS.map((_, index) => band(index));

/** A band that is on: its section's shape and its parameters as the kernel ramps them. */
interface ActiveBand {
  readonly shape: BiquadShape;
  readonly frequency: RampedParameter;
  readonly gain: RampedParameter;
  readonly q: RampedParameter;
}

/** Designs each band's section again whenever its frequency, gain or Q moved. */
class EqualiserDesigner implements CascadeDesigner {
  readonly ramps: readonly RampedParameter[];
  readonly #active: readonly ActiveBand[];
  readonly #rate: number;

  constructor(run: ProcessorRun) {
    const ramp = (parameter: NumericParameterDescriptor) =>
      new RampedParameter(
        parameter,
        run.parameters.number(parameter.key),
        run.sampleRate,
        run.blockFrames,
      );
    // Every band's parameters ramp, so a band that is off takes a move too,
    // and is where it was moved to when it is switched on.
    const ramped = BANDS.map((one) => ({
      one,
      frequency: ramp(one.frequency),
      gain: ramp(one.gain),
      q: ramp(one.q),
    }));
    this.ramps = ramped.flatMap(({ frequency, gain, q }) => [frequency, gain, q]);
    this.#active = ramped
      .filter(({ one }) => run.parameters.toggle(one.on.key))
      .map(({ one, frequency, gain, q }) => ({
        shape: shapeOf(run.parameters.choice(one.type.key)),
        frequency,
        gain,
        q,
      }));
    this.#rate = run.sampleRate;
  }

  get sections(): number {
    return this.#active.length;
  }

  design(cascade: BiquadCascade, frame: number): void {
    for (let section = 0; section < this.#active.length; section += 1) {
      const active = this.#active[section];
      if (active === undefined) continue;
      const { shape, frequency, gain, q } = active;
      let moved = frequency.moved(frame);
      moved = gain.moved(frame) || moved;
      moved = q.moved(frame) || moved;
      if (!moved) continue;
      const settings = cascade.settings;
      settings[SectionSetting.Frequency] = frequency.values[frame] ?? 0;
      settings[SectionSetting.Gain] = gain.values[frame] ?? 0;
      settings[SectionSetting.Q] = q.values[frame] ?? 0;
      cascade.designSection(section, shape, this.#rate);
    }
  }
}

function kernel(run: ProcessorRun): DomainResult<NodeKernel> {
  const designer = new EqualiserDesigner(run);
  const cascade = new BiquadCascade(run.input.roles.length, designer.sections);
  return succeed(new CascadeKernel(TYPE, cascade, designer));
}

/**
 * Frames for the response of every band that is on to decay by 120 dB, one
 * after another: an estimate from each section's slower analogue pole, whose
 * sum bounds the cascade's tail where the slowest band alone would not when
 * two bands share a frequency.
 */
function leadIn({ values, sampleRate }: ProcessorSettings): number {
  let frames = 0;
  for (const one of BANDS) {
    if (!toggleOf(values, one.on)) continue;
    frames += sectionDecayFrames(
      shapeOf(choiceOf(values, one.type)),
      numberOf(values, one.frequency),
      sampleRate,
      numberOf(values, one.gain),
      numberOf(values, one.q),
    );
  }
  return frames;
}

/** Parametric equaliser, as a processor of the rack. */
export const PARAMETRIC_EQUALISER = processorType({
  descriptor: {
    typeKey: TYPE,
    label: 'Parametric equaliser',
    category: ProcessorCategory.Equalisation,
    version: { implementation: 1, parameters: 1 },
    parameters: BANDS.flatMap((one) => [one.on, one.type, one.frequency, one.gain, one.q]),
    qualitySettings: [],
    determinism: DeterminismClass.Canonical,
    wholePass: false,
    realTime: true,
    // Each channel is equalised alike and apart, so any layout is kept as it is.
    outputLayout: (input) => succeed(input),
    latency: () => ({ kind: 'known', frames: ZERO_SAMPLES }),
    leadIn,
  },
  kernel,
});
