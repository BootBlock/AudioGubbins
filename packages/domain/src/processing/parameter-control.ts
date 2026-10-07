/**
 * Where a numeric parameter's value lies on a control's travel, and the value
 * at a place on it, by the parameter's taper (`parameter.ts`).
 *
 * The taper is a domain fact, so the mapping is too: a slider in the rack, one
 * in the Inspector and a later automation lane put 1 kHz at one place, and a
 * value typed at a command is the value a slider reaches there.
 */

import { ParameterTaper, type NumericParameterDescriptor } from './parameter.js';

/**
 * Where `value` lies on the control of `parameter`, from 0 at its minimum to
 * 1 at its maximum, linear in the value or in its decibels, or in its
 * logarithm for a logarithmic taper, whose minimum is above zero. A value
 * outside the range lies outside 0 to 1, so the caller sees it is.
 */
export function controlPosition(parameter: NumericParameterDescriptor, value: number): number {
  const { minimum, maximum } = parameter;
  if (maximum === minimum) return 0;
  switch (parameter.taper) {
    case ParameterTaper.Linear:
    case ParameterTaper.Decibel:
      return (value - minimum) / (maximum - minimum);
    case ParameterTaper.Logarithmic:
      return Math.log(value / minimum) / Math.log(maximum / minimum);
  }
}

/** The decimal places `step` is written with, so a value on it is written with as many. */
function placesOf(step: number): number {
  const [, fraction = ''] = String(step).split('.');
  return fraction.length;
}

/**
 * The value of `parameter` at `position` of its control, 0 to 1 and held
 * there, on the parameter's step where it has one, and within its range: the
 * value a slider reaches there, which the command that sets it accepts.
 */
export function parameterAtPosition(
  parameter: NumericParameterDescriptor,
  position: number,
): number {
  const { minimum, maximum, step } = parameter;
  const at = Math.min(1, Math.max(0, position));
  const raw =
    parameter.taper === ParameterTaper.Logarithmic
      ? minimum * (maximum / minimum) ** at
      : minimum + at * (maximum - minimum);
  if (step === undefined) return Math.min(maximum, Math.max(minimum, raw));
  // Counted from the minimum, so a step that does not divide the range still
  // reaches the minimum, and never past the last step within the maximum;
  // written to the step's own places, so a sum of tenths is a tenth and not
  // its nearest double. The count of steps in the range is taken with a margin
  // far below a step, as 19 divided by a tenth is a hair under 190 in doubles.
  const within = Math.floor((maximum - minimum) / step + 1e-9);
  const steps = Math.min(Math.round((raw - minimum) / step), within);
  return Number((minimum + steps * step).toFixed(placesOf(step)));
}
