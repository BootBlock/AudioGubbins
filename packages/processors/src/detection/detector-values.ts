/**
 * The values a detection's detectors judge by (ADR-0062): what a person set,
 * by detector and parameter key, checked against each detector's own
 * parameters, and every parameter not set at its default.
 *
 * One reading for every reader: the worker that runs a detection, and the
 * command that asks for one, so a value is refused for the same reason
 * wherever it is given. A value out of its parameter's range is refused,
 * never moved into it, as a processor's parameter is.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  validateParameterValue,
  type DetectorValues,
  type DomainResult,
} from '@audiogubbins/domain';

import type { AudioDetector } from './audio-detector.js';

function refused(code: string, summary: string): DomainResult<never> {
  return fail(failure(code, FailureKind.Rejected, summary));
}

/**
 * Every parameter of `detector` with its value: what `given` sets, or its
 * default; or why `given` cannot be judged by: a parameter the detector does
 * not have, a value out of its range, or values the detector's own rule
 * refuses together (`AudioDetector.refusal`).
 */
export function settledValues(
  detector: AudioDetector,
  given: Readonly<Record<string, number>> = {},
): DomainResult<ReadonlyMap<string, number>> {
  const { label } = detector.identity;
  for (const key of Object.keys(given)) {
    if (!detector.parameters.some((parameter) => parameter.key === key)) {
      return refused(
        'detection.parameter-unknown',
        `The ${label} detector has no setting "${key}".`,
      );
    }
  }
  const values = new Map<string, number>();
  for (const parameter of detector.parameters) {
    const value = given[parameter.key] ?? parameter.defaultValue;
    const checked = validateParameterValue(parameter, value);
    if (!checked.ok) {
      const unit = parameter.unit === undefined ? '' : ` ${parameter.unit}`;
      return refused(
        'detection.parameter-out-of-range',
        `The ${label} detector's ${parameter.label.toLowerCase()} is from ${String(parameter.minimum)} to ${String(parameter.maximum)}${unit}.`,
      );
    }
    values.set(parameter.key, value);
  }
  const together = detector.refusal(values);
  return together === undefined
    ? succeed(values)
    : refused('detection.parameters-inconsistent', together);
}

/**
 * The values each of `detectors` judges by, by detector key, from `values`,
 * or why they cannot be: a detector the detection does not run, or one of a
 * detector's values refused by {@link settledValues}.
 */
export function detectionValues(
  detectors: readonly AudioDetector[],
  values: DetectorValues,
): DomainResult<ReadonlyMap<string, ReadonlyMap<string, number>>> {
  for (const key of Object.keys(values)) {
    if (!detectors.some((detector) => detector.identity.key === key)) {
      return refused(
        'detection.detector-unknown',
        `The detection runs no detector "${key}" to give settings to.`,
      );
    }
  }
  const settled = new Map<string, ReadonlyMap<string, number>>();
  for (const detector of detectors) {
    const one = settledValues(detector, values[detector.identity.key]);
    if (!one.ok) return one;
    settled.set(detector.identity.key, one.value);
  }
  return succeed(settled);
}
