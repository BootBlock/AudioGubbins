/**
 * The values a detection's detectors judge by, as command arguments: one
 * argument for each parameter of each detector this build has, named for the
 * detector and the parameter, `silence-threshold` among them, so a key, the
 * palette and a view all set them the same way. A value not given takes the
 * default, or what the analysis it changes used; one given that is not a
 * number is refused, and the values a detection would judge by are refused as
 * the worker refuses them (`settledValues`): out of a parameter's range, never
 * moved into it, or together against the detector's own rule.
 */

import type { CommandInvocation } from '@audiogubbins/commands';
import type { DetectorValues } from '@audiogubbins/domain';
import { CANONICAL_ASSISTANTS, settledValues, type AudioDetector } from '@audiogubbins/processors';

/** Every detector this build has, once each, in the order the assistants name them. */
const DETECTORS: readonly AudioDetector[] = [
  ...new Map(
    CANONICAL_ASSISTANTS.flatMap((assistant) => assistant.detectors).map(
      (detector) => [detector.identity.key, detector] as const,
    ),
  ).values(),
];

/** The argument that sets `parameter` of the detector of `detector`. */
export function detectorArgument(detector: string, parameter: string): string {
  return `${detector}-${parameter}`;
}

/**
 * The detector values an invocation's arguments set, or why one cannot be
 * taken: a value that is not a number. What they judge by, once laid over
 * any they change, is checked by {@link valuesRefusal}.
 */
export function detectorValuesArgument(invocation: CommandInvocation): DetectorValues | string {
  const values: Record<string, Readonly<Record<string, number>>> = {};
  for (const detector of DETECTORS) {
    const given: Record<string, number> = {};
    for (const parameter of detector.parameters) {
      const name = detectorArgument(detector.identity.key, parameter.key);
      const value = invocation.arguments?.[name];
      if (value === undefined) continue;
      if (typeof value !== 'number') return `The ${name} setting is a number.`;
      given[parameter.key] = value;
    }
    if (Object.keys(given).length > 0) values[detector.identity.key] = given;
  }
  return values;
}

/**
 * Why a detection could not judge by `values`, as the worker would refuse
 * them, or `undefined` where it could: the one check, each detector's own.
 */
export function valuesRefusal(values: DetectorValues): string | undefined {
  for (const detector of DETECTORS) {
    const set = values[detector.identity.key];
    if (set === undefined) continue;
    const checked = settledValues(detector, set);
    if (!checked.ok) return checked.failures[0].summary;
  }
  return undefined;
}

/** `given` over `values`, detector by detector and setting by setting. */
export function overlaid(values: DetectorValues, given: DetectorValues): DetectorValues {
  const merged: Record<string, Readonly<Record<string, number>>> = { ...values };
  for (const [detector, set] of Object.entries(given)) {
    merged[detector] = { ...values[detector], ...set };
  }
  return merged;
}

/**
 * Every value `values` gives the detector of `key`, with the default of each
 * it does not, as one text: two sets of values that judge alike are the same
 * text, whichever of them name their defaults.
 */
function judgedBy(values: DetectorValues, key: string): string {
  const detector = DETECTORS.find((one) => one.identity.key === key);
  if (detector === undefined) return '';
  const settled = settledValues(detector, values[key]);
  return settled.ok ? JSON.stringify([...settled.value]) : '';
}

/** Whether two sets of values judge alike, every detector this build has taken at its values. */
export function sameJudging(one: DetectorValues, other: DetectorValues): boolean {
  return DETECTORS.every(
    (detector) => judgedBy(one, detector.identity.key) === judgedBy(other, detector.identity.key),
  );
}
