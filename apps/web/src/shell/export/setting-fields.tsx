/**
 * The two kinds of field every export setting is set with: one of a fixed set
 * of values, and a number typed in. Typed values in and out, so a control is
 * written once over the value it sets and never over the text it shows.
 *
 * A number is taken as typed, never clamped or rounded: whether the value can
 * be made is the import-export package's to say, beside the control. Text
 * that is not a number is kept as typed and said to be one, so the person's
 * keystrokes are not lost.
 */

import { useState, type ReactNode } from 'react';

import { OptionSelect, TextField } from '@audiogubbins/design-system';
import type {
  ExportContext,
  ExportFormat,
  ExportSettings,
  ExportSettingsOf,
  FormatEncodings,
} from '@audiogubbins/import-export';

/** What a group of the dialog's controls is given: the settings, what they are planned against, and how to change them. */
export interface SettingsProps {
  readonly settings: ExportSettings;
  readonly context: ExportContext;
  readonly onSettings: (settings: ExportSettings) => void;
}

/** What a format's encoding controls are given: its settings, and how to set its encoding. */
export interface EncodingProps<F extends ExportFormat> {
  readonly settings: ExportSettingsOf<F>;

  /** What the settings are planned against, whose codecs state the bit rates they take. */
  readonly context: ExportContext;
  readonly onEncoding: (encoding: FormatEncodings[F]) => void;
}

/** The encoding controls of every format, a row each. */
export type EncodingRows = {
  readonly [F in ExportFormat]: (props: EncodingProps<F>) => ReactNode;
};

/** One value of a choice, and what it is called. */
export interface Choice<T> {
  readonly value: T;
  readonly label: string;
}

/** A field choosing one of `choices`, each a value of any type. */
export function ChoiceField<T>({
  label,
  value,
  choices,
  onChoose,
}: {
  readonly label: string;
  readonly value: T;
  readonly choices: readonly Choice<T>[];
  readonly onChoose: (value: T) => void;
}): ReactNode {
  const at = choices.findIndex((choice) => Object.is(choice.value, value));
  return (
    <OptionSelect
      label={label}
      value={String(at)}
      options={choices.map((choice, index) => ({ value: String(index), label: choice.label }))}
      onValueChange={(chosen) => {
        const choice = choices[Number(chosen)];
        if (choice !== undefined) onChoose(choice.value);
      }}
    />
  );
}

/** The choices of a set of numbers, each called as `name` calls it. */
export function numberChoices<N extends number>(
  values: readonly N[],
  name: (value: N) => string = String,
): readonly Choice<N>[] {
  return values.map((value) => ({ value, label: name(value) }));
}

/** The numbers from `lowest` to `highest`, whole. */
export function wholeNumbers(lowest: number, highest: number): readonly number[] {
  return Array.from({ length: highest - lowest + 1 }, (_, index) => lowest + index);
}

/** Text that is a number as a person writes one: digits, a point, and a minus before them. */
const NUMBER = /^\s*-?(\d+(\.\d*)?|\.\d+)\s*$/u;

/** A number the person types, with `unit` after it where it has one. */
export function NumberField({
  label,
  value,
  unit,
  description,
  onNumber,
}: {
  readonly label: string;
  readonly value: number;
  readonly unit?: string;
  readonly description?: string;
  readonly onNumber: (value: number) => void;
}): ReactNode {
  const [typed, setTyped] = useState<string | undefined>(undefined);
  const wrong = typed !== undefined && !NUMBER.test(typed);
  // The text typed is shown while it is the value, or is not a number yet;
  // a value changed elsewhere, as by a preset, is shown as it now is.
  const shown = typed !== undefined && (wrong || Number(typed) === value) ? typed : String(value);
  const said = [
    ...(unit === undefined ? [] : [`In ${unit}.`]),
    ...(description === undefined ? [] : [description]),
    ...(wrong ? ['Write a number.'] : []),
  ].join(' ');
  return (
    <TextField
      label={label}
      value={shown}
      {...(said === '' ? {} : { description: said })}
      onValueChange={(text) => {
        setTyped(text);
        if (NUMBER.test(text)) onNumber(Number(text));
      }}
    />
  );
}
