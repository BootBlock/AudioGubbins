/**
 * What every editor of a policy field is made of (ADR-0101): the value it
 * gives, as the policy commands take it or with the reason it gives none; the
 * command that sets it; a draft that starts again from the value the field
 * resolves to whenever that changes; and the text and number fields most
 * fields are typed into, each beside the control that sets what they give.
 */

import { useState, type ReactNode } from 'react';

import { TextField } from '@audiogubbins/design-system';
import type { DomainResult, Project } from '@audiogubbins/domain';
import type { PolicyField, PolicyValues } from '@audiogubbins/game-audio';
import type { LibraryListing } from '@audiogubbins/storage';

import { policyValueArgument } from '../../commands/game-changes.js';
import type { ProfilePreset } from '../../commands/game-profiles.js';
import type { PanelCommands } from '../command-button.js';
import { HintedCommandButton } from '../hinted-command-button.js';

/** What an editor gives: a value as the commands take it, a saved chain, or why it gives none. */
export type EditedValue =
  { readonly value: string } | { readonly entry: string } | { readonly refused: string };

/** How an editor sets what it gives: the command, its label, and its arguments for a value. */
export interface FieldSetter {
  readonly id: string;
  readonly label: string;
  readonly args: (
    edited: { readonly value: string } | { readonly entry: string },
  ) => Readonly<Record<string, string>>;
}

/** What every editor is given beside its own field's value. */
export interface EditorParts {
  readonly project: Project;
  readonly setter: FieldSetter;
  readonly commands: PanelCommands;

  /** The export presets a profile may be set from. */
  readonly presets: readonly ProfilePreset[];

  /** The saved chains, the built-in ones among them, a group's processing may be set from. */
  readonly library: readonly LibraryListing[];
}

/** The control that sets what an editor gives, with its reason where it gives nothing. */
export function SetButton({
  edited,
  parts,
}: {
  readonly edited: EditedValue;
  readonly parts: EditorParts;
}): ReactNode {
  const { setter, commands } = parts;
  return 'refused' in edited ? (
    <HintedCommandButton
      id={setter.id}
      label={setter.label}
      commands={commands}
      refusal={edited.refused}
      compact
    />
  ) : (
    <HintedCommandButton
      id={setter.id}
      label={setter.label}
      commands={commands}
      args={setter.args(edited)}
      compact
    />
  );
}

/**
 * A draft that starts again from `initial` whenever the value it was started
 * from changes, by this editor's own command, an undo or another view.
 */
export function useDraft<T>(initial: T): readonly [T, (next: T) => void] {
  const [draft, setDraft] = useState(initial);
  const [from, setFrom] = useState(initial);
  if (from !== initial) {
    setFrom(initial);
    setDraft(initial);
  }
  return [draft, setDraft];
}

/** A number typed, or `undefined` where the field holds none. */
function numberIn(typed: string): number | undefined {
  const value = typed.trim() === '' ? Number.NaN : Number(typed);
  return Number.isFinite(value) ? value : undefined;
}

/** A value made by a game-audio constructor, as the commands take it, or its reason. */
export function made<F extends PolicyField>(
  field: F,
  result: DomainResult<PolicyValues[F]>,
): EditedValue {
  return result.ok
    ? { value: policyValueArgument(field, result.value) }
    : { refused: result.failures.map((one) => one.summary).join(' ') };
}

/** A field typed as text, made into a value by `make`. */
export function TextEditor({
  label,
  initial,
  make,
  parts,
}: {
  readonly label: string;
  readonly initial: string;
  readonly make: (typed: string) => EditedValue;
  readonly parts: EditorParts;
}): ReactNode {
  const [typed, setTyped] = useDraft(initial);
  const edited = make(typed);
  return (
    <div className="ag-policy-edit">
      <TextField
        label={label}
        value={typed}
        onValueChange={setTyped}
        onSubmit={() => {
          if (!('refused' in edited))
            parts.commands.run(parts.setter.id, parts.setter.args(edited));
        }}
      />
      <SetButton edited={edited} parts={parts} />
    </div>
  );
}

/** Numbers typed into labelled fields, made into a value by `make` once each is a number. */
export function NumbersEditor({
  fields,
  make,
  parts,
}: {
  readonly fields: readonly {
    readonly label: string;
    readonly initial: string;
    readonly optional?: boolean;
  }[];
  readonly make: (numbers: readonly (number | undefined)[]) => EditedValue;
  readonly parts: EditorParts;
}): ReactNode {
  const [typed, setTyped] = useDraft(fields.map((one) => one.initial).join('\u0000'));
  const values = typed.split('\u0000');
  const numbers = values.map(numberIn);
  const missing = fields.some(
    (one, index) => one.optional !== true && numbers[index] === undefined,
  );
  const edited: EditedValue = missing ? { refused: 'Type a number in each field.' } : make(numbers);
  return (
    <div className="ag-policy-edit">
      {fields.map((one, index) => (
        <TextField
          key={one.label}
          label={one.label}
          value={values[index] ?? ''}
          onValueChange={(next) => {
            setTyped(values.map((value, at) => (at === index ? next : value)).join('\u0000'));
          }}
        />
      ))}
      <SetButton edited={edited} parts={parts} />
    </div>
  );
}
