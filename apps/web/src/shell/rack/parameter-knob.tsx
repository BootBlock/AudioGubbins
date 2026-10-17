/**
 * A processor's number as a knob (REQ-AUDIO-017, REQ-EDIT-072): turned along
 * the parameter's taper (`controlPosition`), its value written in its unit
 * under it, and that value a field a number can be typed into. Every change
 * is the command that sets the parameter, which refuses a value out of range
 * with the range, never clamping it.
 *
 * Nothing is kept here but the value under a drag, shown as it moves: what is
 * kept is what the command wrote once the drag ends or a key steps it, since
 * no history mechanism joins a drag's values into one step, and what is
 * typed, until it is sent.
 */

import { useState, type ReactNode } from 'react';

import { Knob, type SliderScale } from '@audiogubbins/design-system';
import {
  controlPosition,
  parameterAtPosition,
  type NumericParameterDescriptor,
  type ProcessorInstance,
} from '@audiogubbins/domain';

import { numericText } from '../../commands/rack-words.js';
import type { PanelCommands } from '../command-button.js';

/** The steps a control's travel is divided into, each a press of an arrow key. */
const CONTROL_STEPS = 200;

/** A parameter's travel: its taper, in {@link CONTROL_STEPS} steps. */
export function scaleOf(parameter: NumericParameterDescriptor): SliderScale {
  return {
    steps: CONTROL_STEPS,
    positionOf: (value) => controlPosition(parameter, value),
    valueAt: (position) => parameterAtPosition(parameter, position),
  };
}

/** What each control is given: the processor, the view its commands act in, and how they run. */
export interface ControlParts {
  readonly processor: ProcessorInstance;
  readonly panel: string;
  readonly commands: PanelCommands;
}

/**
 * The number typed, as the command reads a number: an empty field is no
 * number, rather than the zero `Number` makes of it, so the command asks for
 * one, and a decimal comma is read as the point it means.
 */
function typedNumber(typed: string): number {
  const trimmed = typed.trim().replace('−', '-').replace(',', '.');
  return trimmed === '' ? Number.NaN : Number(trimmed);
}

/** Runs the command that sets `parameter` of the processor to `value`. */
export function setParameter(
  parts: ControlParts,
  parameter: { readonly key: string },
  value: number | string | boolean,
): void {
  parts.commands.run('rack.set-parameter', {
    view: parts.panel,
    processorId: parts.processor.id,
    key: parameter.key,
    value,
  });
}

/**
 * A number of the processor as a knob. `caption` is the label printed under
 * it where its group already names what it belongs to, as a band of an
 * equaliser does; the typed field always gives the parameter's whole name.
 * Where `typed` is false the value only reads, for a knob that repeats one
 * shown in full elsewhere.
 */
export function ParameterKnob({
  parameter,
  value,
  parts,
  caption = parameter.label,
  typed = true,
}: {
  readonly parameter: NumericParameterDescriptor;
  readonly value: number;
  readonly parts: ControlParts;
  readonly caption?: string;
  readonly typed?: boolean;
}): ReactNode {
  // Only the value under a drag, shown as it moves.
  const [moving, setMoving] = useState<number | undefined>(undefined);
  const shown = moving ?? value;
  const unit = parameter.unit === undefined ? '' : ` in ${parameter.unit}`;
  return (
    <Knob
      label={caption}
      value={shown}
      minimum={parameter.minimum}
      maximum={parameter.maximum}
      scale={scaleOf(parameter)}
      bypassed={!parts.processor.enabled}
      onValueChange={setMoving}
      onValueCommit={(settled) => {
        setMoving(undefined);
        setParameter(parts, parameter, settled);
      }}
      describeValue={(one) => numericText(parameter, one)}
      displayValue={numericText(parameter, shown)}
      {...(typed
        ? {
            typing: {
              label: `${parameter.label}${unit}, typed`,
              text: String(value),
              onSubmit: (text: string) => {
                setParameter(parts, parameter, typedNumber(text));
              },
            },
          }
        : {})}
    />
  );
}
