/**
 * What a workflow's options are set with in its dialog (ADR-0105): how a
 * change reaches the draft, the number options as rows, and the choice of
 * where processing goes for a sound that inherits its group's.
 */

import type { ReactNode } from 'react';

import type { Placement } from '@audiogubbins/guided-workflows';

import type { DraftField, WorkflowDraft } from '../../state/workflow-drafts.js';
import { SourcedChoice, SourcedNumber, type WorkflowUnit } from './workflow-fields.js';
import { PLACEMENTS } from './workflow-words.js';

/** Changes the draft as `change` says. */
export type DraftChange = (change: (draft: WorkflowDraft) => WorkflowDraft) => void;

/** Sets one option of `O`, as the person chose it. */
export type Setter<O> = <F extends keyof O>(field: F, value: O[F]) => void;

/** One number option: its label, its unit, its value and how to set it. */
export interface NumberRow {
  readonly label: string;
  readonly unit: WorkflowUnit;
  readonly field: DraftField<number>;
  readonly set: (value: number) => void;
}

/** The number options, side by side where the dialogue is wide enough. */
export function NumberRows({
  rows,
  children,
}: {
  readonly rows: readonly NumberRow[];

  /** Number options of another kind that stand in the same row, before these. */
  readonly children?: ReactNode;
}): ReactNode {
  return (
    <div className="ag-workflow-numbers">
      {children}
      {rows.map((row) => (
        <SourcedNumber
          key={row.label}
          label={row.label}
          unit={row.unit}
          field={row.field}
          onNumber={row.set}
        />
      ))}
    </div>
  );
}

const PLACEMENT_CHOICES = PLACEMENTS.map((one) => ({ value: one.value, label: one.label }));

export function PlacementChoice({
  field,
  set,
}: {
  readonly field: DraftField<Placement>;
  readonly set: (value: Placement) => void;
}): ReactNode {
  return (
    <SourcedChoice
      label="For a sound that inherits its group’s processing"
      field={field}
      choices={PLACEMENT_CHOICES}
      onChoose={set}
    />
  );
}
