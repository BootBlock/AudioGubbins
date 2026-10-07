/**
 * How a rack and its processors are written (ADR-0060, ADR-0061): a
 * processor's name, a parameter's value with its unit and the range it takes,
 * how a chain is heard, and a chain named by what it runs. One set of words
 * for the commands that refuse a value, the views that show it and the
 * Inspector's list of edits, so a value is never written two ways.
 */

import {
  ProcessorCategory,
  processorsOf,
  type ChainListening,
  type EffectChain,
  type ParameterDescriptor,
  type ParameterValue,
} from '@audiogubbins/domain';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';

/** What a processor of the type `typeKey` is called, standing alone. */
export function processorLabel(typeKey: string): string {
  return (
    PROCESSOR_CATALOGUE.get(typeKey)?.label ?? `A processor this version does not have (${typeKey})`
  );
}

/** The decimal places a value of `step` is written with: its own, or two for a continuous one. */
function placesOf(step: number | undefined): number {
  if (step === undefined) return 2;
  const [, fraction = ''] = String(step).split('.');
  return fraction.length;
}

/** The formatter of numbers to `places` places, each made once. */
const NUMBERS = new Map<number, Intl.NumberFormat>();

function numberText(value: number, places: number): string {
  let format = NUMBERS.get(places);
  if (format === undefined) {
    format = new Intl.NumberFormat('en-GB', { maximumFractionDigits: places });
    NUMBERS.set(places, format);
  }
  // The typographic minus, which a screen reader says as "minus" rather than
  // reading a hyphen as a dash.
  return format.format(value).replace('-', '−');
}

/** A number of `parameter`, with its unit, as `-6 dB` or `1,000 Hz`. */
export function numericText(
  parameter: Extract<ParameterDescriptor, { readonly kind: 'numeric' }>,
  value: number,
): string {
  const text = numberText(value, placesOf(parameter.step));
  return parameter.unit === undefined ? text : `${text} ${parameter.unit}`;
}

/** A value of `parameter` as it is shown: a number with its unit, an option's label, or on or off. */
export function parameterValueText(parameter: ParameterDescriptor, value: ParameterValue): string {
  switch (parameter.kind) {
    case 'numeric':
      return typeof value === 'number' ? numericText(parameter, value) : String(value);
    case 'choice':
      return parameter.options.find((option) => option.key === value)?.label ?? String(value);
    case 'toggle':
      return value === true ? 'On' : 'Off';
  }
}

/** The range a numeric parameter takes, as "from 20 Hz to 20,000 Hz". */
export function rangeText(
  parameter: Extract<ParameterDescriptor, { readonly kind: 'numeric' }>,
): string {
  return `from ${numericText(parameter, parameter.minimum)} to ${numericText(parameter, parameter.maximum)}`;
}

/** How a chain is heard, in a sentence: live, or from a render and why. */
export function listeningText(listening: ChainListening): string {
  return listening.kind === 'live'
    ? 'Heard live: it runs as you listen, and a change is heard at once.'
    : `Heard from a render, made before it plays. ${listening.reason}`;
}

/** A chain named by what it runs, in order: "Gain, then Compressor", or "no processors". */
export function chainWords(chain: Pick<EffectChain, 'slots'>): string {
  const names = [...processorsOf(chain.slots)].map((one) => processorLabel(one.typeKey));
  if (names.length === 0) return 'no processors';
  return names.join(', then ');
}

/** What each category of processor is called, as the menu that adds one heads it. */
export const CATEGORY_NAMES: Readonly<Record<ProcessorCategory, string>> = {
  [ProcessorCategory.Level]: 'Level',
  [ProcessorCategory.Equalisation]: 'Equalisation',
  [ProcessorCategory.Dynamics]: 'Dynamics',
  [ProcessorCategory.Time]: 'Time',
  [ProcessorCategory.Pitch]: 'Pitch',
  [ProcessorCategory.Space]: 'Space',
  [ProcessorCategory.Restoration]: 'Restoration',
  [ProcessorCategory.Separation]: 'Separation',
};
