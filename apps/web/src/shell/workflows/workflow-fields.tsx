/**
 * The fields a workflow's options are set with, each with where its value
 * came from said beside it (ADR-0105): a number, a number that may be left
 * to its detector's default, a choice, a template, and text.
 *
 * Where a value came from is a chip at the end of the field's label line, or
 * under a number, whose fields stand side by side (design language, section
 * 10, "A policy, field by field").
 */

import { useId, useState, type ReactNode } from 'react';

import {
  SourceChip,
  TextField,
  ToggleSwitch,
  type TemplateVocabulary,
} from '@audiogubbins/design-system';

import type { DraftField } from '../../state/workflow-drafts.js';
import { ChoiceField, NumberField, type Choice } from '../export/setting-fields.js';
import { sourceKind, sourceWords } from './workflow-words.js';

/** A field and where its value came from: at its label line's end, or under it. */
function Sourced({
  field,
  under = false,
  children,
}: {
  readonly field: DraftField<unknown>;
  readonly under?: boolean;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="ag-workflow-option" data-ag-source-place={under ? 'under' : 'heading'}>
      {children}
      <span className="ag-workflow-source">
        <SourceChip source={sourceKind(field.source)}>{sourceWords(field.source)}</SourceChip>
      </span>
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
  readonly unit: WorkflowUnit;
  readonly field: DraftField<number>;
  readonly onNumber: (value: number) => void;
}): ReactNode {
  return (
    <Sourced field={field} under>
      <NumberField
        label={label}
        unit={unit.name}
        shownUnit={unit.symbol}
        value={field.value}
        onNumber={onNumber}
      />
    </Sourced>
  );
}

/** A unit a workflow's number is in: its name, said, and its symbol, shown in the field. */
export interface WorkflowUnit {
  readonly name: string;
  readonly symbol: string;
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
  readonly unit: WorkflowUnit;
  readonly field: DraftField<number | undefined>;
  readonly onNumber: (value: number | undefined) => void;
}): ReactNode {
  const [typed, setTyped] = useState<string | undefined>(undefined);
  const said = useId();
  const unset = useId();
  const wrong = typed !== undefined && typed.trim() !== '' && !NUMBER.test(typed);
  const shown = typed ?? (field.value === undefined ? '' : String(field.value));
  return (
    <Sourced field={field} under>
      <span id={said} className="ag-visually-hidden">{`In ${unit.name}.`}</span>
      <span id={unset} className="ag-visually-hidden">
        Leave it empty for the detector’s default.
      </span>
      <TextField
        label={label}
        value={shown}
        unit={unit.symbol}
        placeholder="Default"
        describedBy={`${said} ${unset}`}
        {...(wrong ? { error: 'Write a number.' } : {})}
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
  template,
  onText,
}: {
  readonly label: string;
  readonly description?: string;
  readonly field: DraftField<string>;

  /** Makes the field a template field over this vocabulary. */
  readonly template?: TemplateVocabulary;
  readonly onText: (value: string) => void;
}): ReactNode {
  return (
    <Sourced field={field}>
      <TextField
        label={label}
        {...(description === undefined ? {} : { description })}
        {...(template === undefined ? {} : { template })}
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
