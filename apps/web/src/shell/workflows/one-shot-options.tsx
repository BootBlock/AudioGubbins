/**
 * Prepare One-Shot's options (ADR-0105): how the silence around the sound is
 * found and how much of it is kept, the fades at its new edges, the peak a
 * sound with no loudness target is brought to, and where its processing goes.
 */

import type { ReactNode } from 'react';

import type { PrepareOneShotOptions } from '@audiogubbins/guided-workflows';

import { withChosen, type DraftFields } from '../../state/workflow-drafts.js';
import {
  NumberRows,
  PlacementChoice,
  type DraftChange,
  type NumberRow,
  type Setter,
} from './option-rows.js';
import { SourcedChoice, SourcedOptionalNumber } from './workflow-fields.js';
import { FADE_SHAPES, UNITS } from './workflow-words.js';

/** The number options, each with its label and unit. */
const NUMBERS = [
  ['leadInMilliseconds', 'Lead-in', UNITS.milliseconds],
  ['tailMilliseconds', 'Tail', UNITS.milliseconds],
  ['fadeInMilliseconds', 'Fade in', UNITS.milliseconds],
  ['fadeOutMilliseconds', 'Fade out', UNITS.milliseconds],
  ['peakDbtp', 'True peak, where no loudness target is set', UNITS.dbtp],
] as const;

/** The shapes of the fades at the sound's new edges, side by side. */
function FadeShapes({
  fields,
  set,
}: {
  readonly fields: DraftFields<PrepareOneShotOptions>;
  readonly set: Setter<PrepareOneShotOptions>;
}): ReactNode {
  const shape = (label: string, field: 'fadeInShape' | 'fadeOutShape') => (
    <SourcedChoice
      label={label}
      field={fields[field]}
      choices={FADE_SHAPES}
      onChoose={(value) => {
        set(field, value);
      }}
    />
  );
  return (
    <div className="ag-workflow-pair">
      {shape('Fade-in shape', 'fadeInShape')}
      {shape('Fade-out shape', 'fadeOutShape')}
    </div>
  );
}

export function OneShotOptions({
  fields,
  onDraft,
}: {
  readonly fields: DraftFields<PrepareOneShotOptions>;
  readonly onDraft: DraftChange;
}): ReactNode {
  const set: Setter<PrepareOneShotOptions> = (field, value) => {
    onDraft((now) =>
      now.key === 'prepare-one-shot'
        ? { key: now.key, fields: withChosen(now.fields, field, value) }
        : now,
    );
  };
  const rows = NUMBERS.map(([field, label, unit]): NumberRow => ({
    label,
    unit,
    field: fields[field],
    set: (value) => {
      set(field, value);
    },
  }));
  return (
    <>
      <NumberRows rows={rows}>
        <SourcedOptionalNumber
          label="Silence threshold"
          unit={UNITS.dbfs}
          field={fields.threshold}
          onNumber={(value) => {
            set('threshold', value);
          }}
        />
      </NumberRows>
      <FadeShapes fields={fields} set={set} />
      <PlacementChoice
        field={fields.placement}
        set={(value) => {
          set('placement', value);
        }}
      />
    </>
  );
}
