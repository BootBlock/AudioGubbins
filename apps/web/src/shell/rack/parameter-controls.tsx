/**
 * The controls a processor's parameters are drawn with, by their kind, which
 * a processor's controls (`processor-controls.tsx`) and a type's own
 * presentation (`presentations/`) lay out: a number as a knob
 * (`parameter-knob.tsx`), a choice of two or three as a segmented control and
 * a longer one as an option select, an on or off as a switch, and the menu
 * that resets each number. Every change is the command that sets the
 * parameter.
 */

import type { ReactNode } from 'react';

import {
  IconButton,
  Menu,
  OptionSelect,
  SegmentedControl,
  ToggleSwitch,
} from '@audiogubbins/design-system';
import type {
  ChoiceParameterDescriptor,
  ParameterDescriptor,
  ProcessorDescriptor,
  ToggleParameterDescriptor,
} from '@audiogubbins/domain';

import { ParameterKnob, setParameter, type ControlParts } from './parameter-knob.js';

/** The longest choice drawn as a segmented control; a longer one is an option select. */
const SEGMENTED_CHOICES = 3;

/** A choice of the processor: segmented where it is short, an option select otherwise. */
export function ChoiceControl({
  parameter,
  parts,
  caption = parameter.label,
}: {
  readonly parameter: ChoiceParameterDescriptor;
  readonly parts: ControlParts;
  readonly caption?: string;
}): ReactNode {
  const held = parts.processor.values.get(parameter.id);
  const value = typeof held === 'string' ? held : parameter.defaultKey;
  const options = parameter.options.map((option) => ({ value: option.key, label: option.label }));
  const set = (next: string): void => {
    setParameter(parts, parameter, next);
  };
  if (options.length > SEGMENTED_CHOICES) {
    return (
      <OptionSelect label={parameter.label} value={value} options={options} onValueChange={set} />
    );
  }
  return (
    <div className="ag-processor-choice">
      {/* Its name as the control's caption; the segmented control carries it too. */}
      <span className="ag-processor-caption" aria-hidden="true">
        {caption}
      </span>
      <SegmentedControl
        label={parameter.label}
        value={value}
        options={options}
        onValueChange={set}
        small
      />
    </div>
  );
}

/** An on or off of the processor, a switch. */
export function ToggleControl({
  parameter,
  parts,
  caption = parameter.label,
}: {
  readonly parameter: ToggleParameterDescriptor;
  readonly parts: ControlParts;
  readonly caption?: string;
}): ReactNode {
  return (
    <ToggleSwitch
      label={caption}
      checked={parts.processor.values.get(parameter.id) === true}
      onCheckedChange={(on) => {
        setParameter(parts, parameter, on);
      }}
      small
    />
  );
}

/** The menu that sets each number of the processor back to its default. */
export function ResetMenu({
  parameters,
  parts,
}: {
  readonly parameters: readonly ParameterDescriptor[];
  readonly parts: ControlParts;
}): ReactNode {
  const { processor, panel, commands } = parts;
  const numbers = parameters.filter((parameter) => parameter.kind === 'numeric');
  if (numbers.length === 0) return null;
  return (
    <Menu
      label="Reset a setting"
      trigger={<IconButton icon="reset" label="Reset a setting" compact />}
      groups={[
        {
          key: 'reset',
          items: numbers.map((parameter) => {
            const args = { view: panel, processorId: processor.id, key: parameter.key };
            const reason = commands.unavailableReason('rack.reset-parameter', args);
            return {
              key: parameter.key,
              label: `Reset ${parameter.label.toLowerCase()}`,
              ...(reason === undefined ? {} : { unavailableReason: reason }),
              onSelect: () => {
                commands.run('rack.reset-parameter', args);
              },
            };
          }),
        },
      ]}
    />
  );
}

/** Every parameter of `parameters` by the control its kind is drawn as: the numbers as knobs, then the rest. */
export function ParameterControls({
  parameters,
  parts,
}: {
  readonly parameters: readonly ParameterDescriptor[];
  readonly parts: ControlParts;
}): ReactNode {
  const numbers = parameters.flatMap((parameter) =>
    parameter.kind === 'numeric' ? [parameter] : [],
  );
  const others = parameters.filter((parameter) => parameter.kind !== 'numeric');
  return (
    <>
      {numbers.length > 0 && (
        <div className="ag-processor-knobs">
          {numbers.map((parameter) => {
            const value = parts.processor.values.get(parameter.id);
            return typeof value === 'number' ? (
              <ParameterKnob key={parameter.id} parameter={parameter} value={value} parts={parts} />
            ) : (
              <p key={parameter.id} className="ag-panel-note">
                {`${parameter.label} holds no number this version reads.`}
              </p>
            );
          })}
        </div>
      )}
      {others.length > 0 && (
        <div className="ag-processor-choices">
          {others.map((parameter) =>
            parameter.kind === 'choice' ? (
              <ChoiceControl key={parameter.id} parameter={parameter} parts={parts} />
            ) : (
              <ToggleControl key={parameter.id} parameter={parameter} parts={parts} />
            ),
          )}
        </div>
      )}
    </>
  );
}

/** What a type's own presentation is given. */
export interface PresentationProps {
  readonly descriptor: ProcessorDescriptor;
  readonly parts: ControlParts;
  /** The rate of the audio it processes, which its response is drawn at. */
  readonly sampleRate: number;
}
