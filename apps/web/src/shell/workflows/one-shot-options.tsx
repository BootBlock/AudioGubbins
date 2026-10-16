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
import { FADE_SHAPES } from './workflow-words.js';

/** The number options, each with its label and unit. */
const NUMBERS = [
  ['leadInMilliseconds', 'Lead-in', 'milliseconds'],
  ['tailMilliseconds', 'Tail', 'milliseconds'],
  ['fadeInMilliseconds', 'Fade in', 'milliseconds'],
  ['fadeOutMilliseconds', 'Fade out', 'milliseconds'],
  ['peakDbtp', 'True peak, where no loudness target is set', 'dBTP'],
] as const;

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
    <>
      <SourcedOptionalNumber
        label="Silence threshold"
        unit="dBFS"
        field={fields.threshold}
        onNumber={(value) => {
          set('threshold', value);
        }}
      />
      <NumberRows rows={rows} />
      {shape('Fade-in shape', 'fadeInShape')}
      {shape('Fade-out shape', 'fadeOutShape')}
      <PlacementChoice
        field={fields.placement}
        set={(value) => {
          set('placement', value);
        }}
      />
    </>
  );
}
