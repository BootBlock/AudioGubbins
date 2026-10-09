/**
 * The commands that set a processor's parameters (ADR-0060, REQ-AUDIO-017):
 * one value, by its key, or back to its default, through the command that
 * sets one processor, so the change reaches every target that names its
 * chain and one undo reverses it. A value the parameter does not take is
 * refused with the range it does, never clamped: a slider, a typed value and
 * a macro are refused alike.
 *
 * No history mechanism joins a drag's values into one step, so a control
 * sends a value as the person settles on it: as a drag ends, at each keyboard
 * step and as a value is typed. Each is a change the transport follows while
 * it plays (`PlaybackControl.follow`).
 */

import {
  CommandCategory,
  unchanged,
  type Command,
  type CommandInvocation,
} from '@audiogubbins/commands';
import {
  defaultParameterValue,
  parameterOf,
  validateParameterValue,
  type ParameterDescriptor,
  type ParameterValue,
  type ProcessorInstance,
} from '@audiogubbins/domain';
import { setProcessorInvocation } from '@audiogubbins/project-commands';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import { quoted } from '@audiogubbins/text';

import { processorArgument, processorIn } from './library-access.js';
import { sessionOf } from './project-access.js';
import { changeRacks } from './rack-changes.js';
import { needsProjectAsset } from './project-edits.js';
import { parameterValueText, processorLabel, rangeText } from './rack-words.js';
import { shellCommand, textArgument, type BodyAnswer } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** The processor and parameter an invocation names, or why it names none. */
function parameterNamed(
  context: ShellContext,
  invocation: CommandInvocation,
): { readonly processor: ProcessorInstance; readonly parameter: ParameterDescriptor } | string {
  const session = sessionOf(context);
  if (typeof session === 'string') return session;
  const id = processorArgument(context, invocation);
  if (id === undefined) return 'Select one processor, or name it, to change its settings.';
  const processor = processorIn(session.getSnapshot().model.state, id);
  if (processor === undefined) return 'The project has no such processor.';
  const descriptor = PROCESSOR_CATALOGUE.get(processor.typeKey);
  if (descriptor === undefined) {
    return `${processorLabel(processor.typeKey)}: this version cannot change its settings.`;
  }
  const key = textArgument(invocation, 'key');
  const parameter = key === undefined ? undefined : parameterOf(descriptor, key);
  if (parameter === undefined) return `${descriptor.label} has no setting of that name.`;
  return { processor, parameter };
}

/**
 * Why `value` is not one `parameter` takes, in words, or nothing where it is:
 * a number outside its range is refused with the range, never clamped.
 */
function refusalOf(parameter: ParameterDescriptor, value: ParameterValue): string | undefined {
  if (validateParameterValue(parameter, value).ok) return undefined;
  switch (parameter.kind) {
    case 'numeric':
      return typeof value === 'number' && Number.isFinite(value)
        ? `${parameter.label} is ${rangeText(parameter)}; ${parameterValueText(parameter, value)} is outside it.`
        : `${parameter.label} takes a number, ${rangeText(parameter)}.`;
    case 'choice':
      return `${parameter.label} is one of ${parameter.options.map((option) => option.label).join(', ')}.`;
    case 'toggle':
      return `${parameter.label} is on or off.`;
  }
}

/** Gives `processor` `value` for `parameter`, as one change, or says why not. */
function setValue(
  context: ShellContext,
  processor: ProcessorInstance,
  parameter: ParameterDescriptor,
  value: ParameterValue,
): BodyAnswer {
  const refused = refusalOf(parameter, value);
  if (refused !== undefined) return refused;
  const name = quoted(processorLabel(processor.typeKey));
  const shown = parameterValueText(parameter, value);
  if (Object.is(processor.values.get(parameter.id), value)) {
    return unchanged('rack.unchanged', `${parameter.label} of ${name} is ${shown} already.`);
  }
  const values = new Map(processor.values);
  values.set(parameter.id, value);
  return changeRacks(context, {
    description: `Set the ${parameter.label.toLowerCase()} of ${name}`,
    invocations: [setProcessorInvocation({ ...processor, values })],
    said: `${parameter.label} of ${name} set to ${shown}.`,
  });
}

function setParameterCommand(): Command<ShellContext> {
  return shellCommand(
    'rack.set-parameter',
    'Set a processor’s setting',
    CommandCategory.Edit,
    (context, invocation) => {
      const named = parameterNamed(context, invocation);
      if (typeof named === 'string') return named;
      const value = invocation.arguments?.['value'];
      if (value === undefined || value === null) return `Give ${named.parameter.label} a value.`;
      return setValue(context, named.processor, named.parameter, value);
    },
    {
      availability: needsProjectAsset,
      keywords: ['parameter', 'setting', 'value', 'processor', 'effect', 'change'],
      discoverable: false,
    },
  );
}

function resetParameterCommand(): Command<ShellContext> {
  return shellCommand(
    'rack.reset-parameter',
    'Reset a processor’s setting',
    CommandCategory.Edit,
    (context, invocation) => {
      const named = parameterNamed(context, invocation);
      if (typeof named === 'string') return named;
      return setValue(
        context,
        named.processor,
        named.parameter,
        defaultParameterValue(named.parameter),
      );
    },
    {
      availability: needsProjectAsset,
      keywords: ['reset', 'default', 'parameter', 'setting', 'processor'],
      discoverable: false,
    },
  );
}

/** The commands that set a processor's parameters. */
export function rackParameterCommands(): readonly Command<ShellContext>[] {
  return [setParameterCommand(), resetParameterCommand()];
}
