/**
 * Automatable processor parameters.
 *
 * REQ-ARCH-004.4 requires "automation-ready parameters" in the model from the
 * first production phase. A parameter is therefore described rather than merely
 * stored: its range, its default, its unit and how it maps to a control are
 * part of the domain, so that a slider, a command, the Inspector, an automation
 * lane and a future scripting API all agree about what a value means.
 *
 * REQ-PROD-158 excludes MIDI. Nothing here anticipates a controller; the
 * descriptors exist because AudioGubbins' own automation and Inspector need
 * them.
 */

import type { ParameterId } from '../identity/branded-id.js';
import { failure, FailureKind, type DomainResult, fail, succeed } from '../result.js';

/**
 * How a parameter's value maps onto a linear control.
 *
 * The taper is a domain fact, not a presentation choice: a frequency control
 * whose midpoint sits at 1 kHz rather than 10 kHz is the same in the Inspector,
 * in an automation lane and in a value typed into a command.
 */
export const ParameterTaper = {
  /** The control position is the value. */
  Linear: 'linear',

  /** Equal control movements make equal ratios. For frequency and time. */
  Logarithmic: 'logarithmic',

  /** The value is a level in decibels; the control is linear in decibels. */
  Decibel: 'decibel',
} as const;

/** How a parameter's value maps onto a linear control. */
export type ParameterTaper = (typeof ParameterTaper)[keyof typeof ParameterTaper];

/** A continuous numeric parameter. */
export interface NumericParameterDescriptor {
  readonly kind: 'numeric';
  readonly id: ParameterId;

  /** Stable machine-readable key, for example `cutoff-frequency`. */
  readonly key: string;

  /** British-English label for the Inspector (REQ-PRIV-164). */
  readonly label: string;

  readonly minimum: number;
  readonly maximum: number;
  readonly defaultValue: number;
  readonly taper: ParameterTaper;

  /**
   * Unit suffix shown beside the value, for example `Hz` or `dB`.
   *
   * Unit symbols are international and are not translated or anglicised.
   */
  readonly unit?: string;

  /**
   * Smallest meaningful change, or `undefined` for a continuous parameter.
   *
   * A stepped parameter still stores a number; the step governs what a control
   * and a keyboard nudge produce, not what the value may be.
   */
  readonly step?: number;
}

/** A parameter that selects one of a fixed set of options. */
export interface ChoiceParameterDescriptor {
  readonly kind: 'choice';
  readonly id: ParameterId;
  readonly key: string;
  readonly label: string;

  /**
   * The available options.
   *
   * Each option has a stable `key` and a separate `label`. REQ-PRIV-164
   * requires machine-readable values to stay independent of the visible
   * British-English text, so renaming a label never changes a saved project.
   */
  readonly options: readonly [ChoiceOption, ...ChoiceOption[]];

  readonly defaultKey: string;
}

/** One option of a choice parameter. */
export interface ChoiceOption {
  readonly key: string;
  readonly label: string;
}

/** A parameter that is either on or off. */
export interface ToggleParameterDescriptor {
  readonly kind: 'toggle';
  readonly id: ParameterId;
  readonly key: string;
  readonly label: string;
  readonly defaultValue: boolean;
}

/** Describes one parameter of a processor. */
export type ParameterDescriptor =
  NumericParameterDescriptor | ChoiceParameterDescriptor | ToggleParameterDescriptor;

/** A value a parameter may hold. */
export type ParameterValue = number | string | boolean;

/**
 * Checks a value against its descriptor.
 *
 * Returns the value the parameter should hold. A numeric value outside the
 * range is rejected rather than clamped: silently accepting 20 kHz where the
 * maximum is 18 kHz would make the stored project disagree with what the user
 * asked for, and a later reader could not tell which was intended.
 */
export function validateParameterValue(
  descriptor: ParameterDescriptor,
  value: ParameterValue,
): DomainResult<ParameterValue> {
  switch (descriptor.kind) {
    case 'numeric': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fail(
          failure(
            'parameter.expected-finite-number',
            FailureKind.Rejected,
            `Parameter "${descriptor.key}" takes a finite number.`,
            {
              details: { key: descriptor.key, received: typeof value },
            },
          ),
        );
      }
      if (value < descriptor.minimum || value > descriptor.maximum) {
        return fail(
          failure(
            'parameter.out-of-range',
            FailureKind.Rejected,
            `Parameter "${descriptor.key}" accepts ${String(descriptor.minimum)} to ${String(descriptor.maximum)}.`,
            {
              details: {
                key: descriptor.key,
                value,
                minimum: descriptor.minimum,
                maximum: descriptor.maximum,
              },
            },
          ),
        );
      }
      return succeed(value);
    }

    case 'choice': {
      if (typeof value !== 'string') {
        return fail(
          failure(
            'parameter.expected-option-key',
            FailureKind.Rejected,
            `Parameter "${descriptor.key}" takes one of its option keys.`,
            {
              details: { key: descriptor.key, received: typeof value },
            },
          ),
        );
      }
      if (!descriptor.options.some((option) => option.key === value)) {
        return fail(
          failure(
            'parameter.unknown-option',
            FailureKind.Rejected,
            `Parameter "${descriptor.key}" has no option "${value}".`,
            {
              details: {
                key: descriptor.key,
                value,
                available: descriptor.options.map((option) => option.key).join(', '),
              },
            },
          ),
        );
      }
      return succeed(value);
    }

    case 'toggle': {
      if (typeof value !== 'boolean') {
        return fail(
          failure(
            'parameter.expected-boolean',
            FailureKind.Rejected,
            `Parameter "${descriptor.key}" is on or off.`,
            {
              details: { key: descriptor.key, received: typeof value },
            },
          ),
        );
      }
      return succeed(value);
    }
  }
}

/** The value a parameter holds before a user changes it. */
export function defaultParameterValue(descriptor: ParameterDescriptor): ParameterValue {
  switch (descriptor.kind) {
    case 'numeric':
      return descriptor.defaultValue;
    case 'choice':
      return descriptor.defaultKey;
    case 'toggle':
      return descriptor.defaultValue;
  }
}
