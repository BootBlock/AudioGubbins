/**
 * The fields a workflow's options are set with, each with where its value
 * came from said beside it (ADR-0105): a number, a number that may be left
 * to its detector's default, a choice, and text.
 */

import { useState, type ReactNode } from 'react';

import { TextField, ToggleSwitch } from '@audiogubbins/design-system';

import type { DraftField } from '../../state/workflow-drafts.js';
import { ChoiceField, NumberField, type Choice } from '../export/setting-fields.js';
import { sourceWords } from './workflow-words.js';

/** A field and, below it, where its value came from. */
function Sourced({
  field,
  children,
}: {
  readonly field: DraftField<unknown>;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="ag-workflow-option">
      {children}
      <p className="ag-workflow-source">{sourceWords(field.source)}</p>
    </div>
  );
}

export function SourcedNumber({
  label,
  unit,
  field,
  onNumber,
}: {
  readonly label: string;
  readonly unit: string;
  readonly field: DraftField<number>;
  readonly onNumber: (value: number) => void;
}): ReactNode {
  return (
    <Sourced field={field}>
      <NumberField label={label} unit={unit} value={field.value} onNumber={onNumber} />
    </Sourced>
  );
}

/** Text that is a number as a person writes one, or nothing. */
const NUMBER = /^\s*-?(\d+(\.\d*)?|\.\d+)\s*$/u;

/** A number that may be left empty, for the detector's own default. */
export function SourcedOptionalNumber({
  label,
  unit,
  field,
  onNumber,
}: {
  readonly label: string;
  readonly unit: string;
  readonly field: DraftField<number | undefined>;
  readonly onNumber: (value: number | undefined) => void;
}): ReactNode {
  const [typed, setTyped] = useState<string | undefined>(undefined);
  const wrong = typed !== undefined && typed.trim() !== '' && !NUMBER.test(typed);
  const shown = typed ?? (field.value === undefined ? '' : String(field.value));
  return (
    <Sourced field={field}>
      <TextField
        label={label}
        value={shown}
        description={`In ${unit}. Leave it empty for the detector’s default.${wrong ? ' Write a number.' : ''}`}
        onValueChange={(text) => {
          setTyped(text);
          if (text.trim() === '') onNumber(undefined);
          else if (NUMBER.test(text)) onNumber(Number(text));
        }}
      />
    </Sourced>
  );
}

export function SourcedChoice<T>({
  label,
  field,
  choices,
  onChoose,
}: {
  readonly label: string;
  readonly field: DraftField<T>;
  readonly choices: readonly Choice<T>[];
  readonly onChoose: (value: T) => void;
}): ReactNode {
  return (
    <Sourced field={field}>
      <ChoiceField label={label} value={field.value} choices={choices} onChoose={onChoose} />
    </Sourced>
  );
}

export function SourcedText({
  label,
  description,
  field,
  onText,
}: {
  readonly label: string;
  readonly description: string;
  readonly field: DraftField<string>;
  readonly onText: (value: string) => void;
}): ReactNode {
  return (
    <Sourced field={field}>
      <TextField
        label={label}
        description={description}
        value={field.value}
        onValueChange={onText}
      />
    </Sourced>
  );
}

export function SourcedSwitch({
  label,
  description,
  field,
  onSwitch,
}: {
  readonly label: string;
  readonly description: string;
  readonly field: DraftField<boolean>;
  readonly onSwitch: (value: boolean) => void;
}): ReactNode {
  return (
    <Sourced field={field}>
      <ToggleSwitch
        label={label}
        description={description}
        checked={field.value}
        onCheckedChange={onSwitch}
      />
    </Sourced>
  );
}
