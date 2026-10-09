/**
 * A processor's controls (REQ-AUDIO-017, REQ-EDIT-072): one for each of its
 * parameters, as its descriptor describes it, shared by the Effects rack and
 * the Inspector, so a processor is set one way wherever it is shown.
 *
 * A number is a slider along the parameter's taper (`controlPosition`), with
 * its value typed beside it in its unit; a choice is an option select; an on
 * or off is a switch; and each has a reset. Every change is the command that
 * sets the parameter, which refuses a value out of range with the range,
 * never clamping it. Nothing is kept here: a slider shows the value under a
 * drag as it moves, and what is kept is what the command wrote once the drag
 * ends or a key steps it, since no history mechanism joins a drag's values
 * into one step.
 */

import { useState, type ReactNode } from 'react';

import {
  OptionSelect,
  TextField,
  ToggleSwitch,
  ValueSlider,
  type SliderScale,
} from '@audiogubbins/design-system';
import {
  controlPosition,
  parameterAtPosition,
  type NumericParameterDescriptor,
  type ParameterDescriptor,
  type ProcessorDescriptor,
  type ProcessorInstance,
} from '@audiogubbins/domain';

import { numericText, parameterValueText } from '../../commands/rack-words.js';
import { CommandButton, type PanelCommands } from '../command-button.js';

/** The steps a slider's travel is divided into, each a press of an arrow key. */
const CONTROL_STEPS = 200;

/** A parameter's slider scale: its taper, in {@link CONTROL_STEPS} steps. */
function sliderScaleOf(parameter: NumericParameterDescriptor): SliderScale {
  return {
    steps: CONTROL_STEPS,
    positionOf: (value) => controlPosition(parameter, value),
    valueAt: (position) => parameterAtPosition(parameter, position),
  };
}

/** What each control is given: the processor, the view its commands act in, and how they run. */
interface ControlParts {
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

/** A number's value typed in its unit, sent as the person presses Enter, and its reset. */
function TypedValue({
  parameter,
  value,
  parts,
  set,
}: {
  readonly parameter: NumericParameterDescriptor;
  readonly value: number;
  readonly parts: ControlParts;
  readonly set: (value: number) => void;
}): ReactNode {
  const { processor, panel, commands } = parts;
  // What is being typed, until it is sent; the field shows the value kept
  // otherwise, so an undo is seen in it.
  const [typed, setTyped] = useState<string | undefined>(undefined);
  const unit = parameter.unit === undefined ? '' : ` in ${parameter.unit}`;
  return (
    <div className="ag-inspector-row">
      <TextField
        label={`${parameter.label}${unit}, typed`}
        value={typed ?? String(value)}
        onValueChange={setTyped}
        onSubmit={() => {
          if (typed === undefined) return;
          set(typedNumber(typed));
          setTyped(undefined);
        }}
      />
      <CommandButton
        id="rack.reset-parameter"
        label={`Reset ${parameter.label.toLowerCase()}`}
        commands={commands}
        args={{ view: panel, processorId: processor.id, key: parameter.key }}
        compact
      />
    </div>
  );
}

/** A number: a slider along its taper, its value typed in its unit, and a reset. */
function NumericControl({
  parameter,
  value,
  parts,
}: {
  readonly parameter: NumericParameterDescriptor;
  readonly value: number;
  readonly parts: ControlParts;
}): ReactNode {
  const { processor, panel, commands } = parts;
  // Only the value under a drag, shown as it moves; what is kept is the
  // processor's value, which the command sets.
  const [moving, setMoving] = useState<number | undefined>(undefined);
  const shown = moving ?? value;
  const set = (next: number): void => {
    commands.run('rack.set-parameter', {
      view: panel,
      processorId: processor.id,
      key: parameter.key,
      value: next,
    });
  };
  return (
    <div className="ag-rack-parameter">
      <ValueSlider
        label={parameter.label}
        value={shown}
        minimum={parameter.minimum}
        maximum={parameter.maximum}
        scale={sliderScaleOf(parameter)}
        onValueChange={setMoving}
        onValueCommit={(settled) => {
          setMoving(undefined);
          set(settled);
        }}
        describeValue={(one) => numericText(parameter, one)}
        displayValue={numericText(parameter, shown)}
      />
      <TypedValue parameter={parameter} value={value} parts={parts} set={set} />
    </div>
  );
}

/** One parameter's control, as its descriptor describes it. */
function ParameterControl({
  parameter,
  parts,
}: {
  readonly parameter: ParameterDescriptor;
  readonly parts: ControlParts;
}): ReactNode {
  const { processor, panel, commands } = parts;
  const value = processor.values.get(parameter.id);
  const set = (next: string | boolean): void => {
    commands.run('rack.set-parameter', {
      view: panel,
      processorId: processor.id,
      key: parameter.key,
      value: next,
    });
  };
  switch (parameter.kind) {
    case 'numeric':
      return typeof value === 'number' ? (
        <NumericControl parameter={parameter} value={value} parts={parts} />
      ) : (
        <p>{`${parameter.label} holds no number this version reads.`}</p>
      );
    case 'choice':
      return (
        <OptionSelect
          label={parameter.label}
          value={typeof value === 'string' ? value : parameter.defaultKey}
          options={parameter.options.map((option) => ({ value: option.key, label: option.label }))}
          onValueChange={set}
        />
      );
    case 'toggle':
      return (
        <ToggleSwitch
          label={parameter.label}
          checked={value === true}
          onCheckedChange={set}
          description={`${parameterValueText(parameter, value ?? false)} now.`}
        />
      );
  }
}

/** The controls of every parameter of `processor`, in its descriptor's order. */
export function ProcessorControls({
  processor,
  descriptor,
  panel,
  commands,
}: {
  readonly processor: ProcessorInstance;
  readonly descriptor: ProcessorDescriptor;
  readonly panel: string;
  readonly commands: PanelCommands;
}): ReactNode {
  const parts: ControlParts = { processor, panel, commands };
  return descriptor.parameters.length === 0 ? (
    <p className="ag-panel-note">{`${descriptor.label} has no settings.`}</p>
  ) : (
    <div className="ag-inspector-controls">
      {descriptor.parameters.map((parameter) => (
        <ParameterControl key={parameter.id} parameter={parameter} parts={parts} />
      ))}
    </div>
  );
}
