/**
 * A parameter's value as a descriptor's `latency` and `leadIn` are given it:
 * by its identifier, from the instance's values, which name every parameter
 * of the type; the default stands in for one a caller leaves out.
 */

import type {
  ChoiceParameterDescriptor,
  NumericParameterDescriptor,
  ParameterValues,
  ToggleParameterDescriptor,
} from '@audiogubbins/domain';

/** The value of the numeric `parameter` in `values`. */
export function numberOf(values: ParameterValues, parameter: NumericParameterDescriptor): number {
  const value = values.get(parameter.id);
  return typeof value === 'number' ? value : parameter.defaultValue;
}

/** The option key of the choice `parameter` in `values`. */
export function choiceOf(values: ParameterValues, parameter: ChoiceParameterDescriptor): string {
  const value = values.get(parameter.id);
  return typeof value === 'string' ? value : parameter.defaultKey;
}

/** Whether the toggle `parameter` is on in `values`. */
export function toggleOf(values: ParameterValues, parameter: ToggleParameterDescriptor): boolean {
  const value = values.get(parameter.id);
  return typeof value === 'boolean' ? value : parameter.defaultValue;
}
