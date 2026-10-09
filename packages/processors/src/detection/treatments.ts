/**
 * The processors the canonical detectors' findings are treated with, the
 * order an assistant applies them in, and the values a treatment sets, each
 * read from the processor's own descriptor so a treatment cannot name a
 * parameter, an option or a range the processor does not have.
 */

import type {
  ChoiceParameterDescriptor,
  EditRange,
  NumericParameterDescriptor,
  ParameterDescriptor,
  TreatmentStep,
} from '@audiogubbins/domain';

import type { ProcessorType } from '../framework/processor-type.js';
import { DC_OFFSET_REMOVAL } from '../filters/dc-offset-removal.js';
import { DE_HUM } from '../filters/de-hum.js';
import { DE_CLICK } from '../repair/de-click.js';
import { NOISE_REDUCTION } from '../spectral/noise-reduction.js';

/** The parameter of `type` keyed `key`: absent, it is a fault in this build. */
function parameterOf(type: ProcessorType, key: string): ParameterDescriptor {
  const found = type.descriptor.parameters.find((parameter) => parameter.key === key);
  if (found === undefined) {
    throw new Error(`The ${type.descriptor.typeKey} processor has no parameter "${key}".`);
  }
  return found;
}

/** The numeric parameter of `type` keyed `key`. */
function numericOf(type: ProcessorType, key: string): NumericParameterDescriptor {
  const found = parameterOf(type, key);
  if (found.kind !== 'numeric') throw new Error(`Parameter "${key}" is not numeric.`);
  return found;
}

/** The key of the choice of `type` keyed `key`, which must offer every one of `options`. */
function choiceKeyOf(type: ProcessorType, key: string, options: readonly string[]): string {
  const found = parameterOf(type, key);
  if (found.kind !== 'choice') throw new Error(`Parameter "${key}" is not a choice.`);
  const offered = (option: string, choice: ChoiceParameterDescriptor): boolean =>
    choice.options.some((one) => one.key === option);
  const missing = options.find((option) => !offered(option, found));
  if (missing !== undefined) throw new Error(`Parameter "${key}" has no option "${missing}".`);
  return found.key;
}

/**
 * The type keys of every treatment, in the order an assistant applies them.
 * A DC offset first, as it skews every stage after it: the notches' and the
 * predictor's input and the noise's spectrum at its lowest bin. Hum before
 * clicks, as a steady line is what a click's predictor should follow, not
 * fight. Noise reduction last, so the profile it subtracts is the noise
 * alone, with no hum, click or offset learned into it.
 */
export const TREATMENT_ORDER: readonly string[] = [
  DC_OFFSET_REMOVAL.descriptor.typeKey,
  DE_HUM.descriptor.typeKey,
  DE_CLICK.descriptor.typeKey,
  NOISE_REDUCTION.descriptor.typeKey,
];

/** A DC offset removal at its default cutoff, which takes out a fixed or drifting offset alike. */
export function dcOffsetRemovalStep(): TreatmentStep {
  return { typeKey: DC_OFFSET_REMOVAL.descriptor.typeKey, values: {} };
}

/** The de-hum's fine offset: how far from its nominal a fundamental may be moved. */
export const HUM_OFFSET = numericOf(DE_HUM, 'offset');

/** A mains fundamental, by its nominal frequency, and the de-hum's option key for it. */
export const MAINS = [
  { hertz: 50, option: '50-hz' },
  { hertz: 60, option: '60-hz' },
] as const;

const FUNDAMENTAL = choiceKeyOf(
  DE_HUM,
  'fundamental',
  MAINS.map((mains) => mains.option),
);

/** The steps of the de-hum's fine offset: a measured frequency is set to the nearest. */
const OFFSETS_PER_HERTZ = 100;

/**
 * A de-hum at the mains `option`, moved by `offset` hertz to where the hum
 * was measured, rounded to the parameter's hundredth of a hertz and held to
 * its range: a notch of the default Q is under a hertz wide at 50 Hz, so a
 * supply a few tenths off its nominal would be missed at the nominal.
 */
export function deHumStep(option: string, offset: number): TreatmentStep {
  const rounded = Math.floor(offset * OFFSETS_PER_HERTZ + 0.5) / OFFSETS_PER_HERTZ;
  const held = Math.min(HUM_OFFSET.maximum, Math.max(HUM_OFFSET.minimum, rounded));
  return {
    typeKey: DE_HUM.descriptor.typeKey,
    values: { [FUNDAMENTAL]: option, [HUM_OFFSET.key]: held },
  };
}

/** The de-click's sensitivity, and its longest click. */
export const CLICK_SENSITIVITY = numericOf(DE_CLICK, 'sensitivity');
export const LONGEST_CLICK = numericOf(DE_CLICK, 'maximum-length');

/**
 * A de-click at its default sensitivity: the click detector judges events at
 * that sensitivity on the de-click's own blocks, so the de-click flags every
 * sample the detector found, and no other.
 */
export function deClickStep(): TreatmentStep {
  return {
    typeKey: DE_CLICK.descriptor.typeKey,
    values: { [CLICK_SENSITIVITY.key]: CLICK_SENSITIVITY.defaultValue },
  };
}

/** A noise reduction at its defaults, its profile learned from `stretch`, the noise alone. */
export function noiseReductionStep(stretch: EditRange): TreatmentStep {
  return { typeKey: NOISE_REDUCTION.descriptor.typeKey, values: {}, learnFrom: stretch };
}
