/**
 * Cut Into Sounds's options (ADR-0105): the group the sounds are put in, one
 * the project has or a new one the step makes, their naming, how the silence
 * between them is found, and how much of it each sound keeps.
 */

import type { ReactNode } from 'react';

import { NO_GAME_AUDIO, groupPath, pathText } from '@audiogubbins/game-audio';
import type { ProjectState } from '@audiogubbins/project-format';

import { withChosen, type CutDraft, type DraftFields } from '../../state/workflow-drafts.js';
import type { Choice } from '../export/setting-fields.js';
import { NAMING_FIELD } from '../template-vocabularies.js';
import { NumberRows, type DraftChange, type Setter } from './option-rows.js';
import {
  SourcedChoice,
  SourcedOptionalNumber,
  SourcedText,
  type WorkflowUnit,
} from './workflow-fields.js';
import { UNITS } from './workflow-words.js';

/** The choice of a new group, which no group's identifier can be. */
const NEW_GROUP = '\u0000new';

/** The groups to put the sounds in, a new one last, and which is chosen. */
function destinationChoices(
  fields: DraftFields<CutDraft>,
  state: ProjectState,
): { readonly choices: readonly Choice<string>[]; readonly chosen: string } {
  const { groups } = state.gameAudio ?? NO_GAME_AUDIO;
  const destination = fields.destination.value;
  const unchosen = destination.kind === 'group' && destination.group === undefined;
  const choices = [
    ...(unchosen ? [{ value: '', label: 'Choose a group' }] : []),
    ...[...groups.keys()].map((id) => ({ value: id, label: pathText(groupPath(groups, id)) })),
    { value: NEW_GROUP, label: 'A new group…' },
  ];
  if (destination.kind === 'new') return { choices, chosen: NEW_GROUP };
  return { choices, chosen: destination.group ?? '' };
}

function Destination({
  fields,
  state,
  set,
}: {
  readonly fields: DraftFields<CutDraft>;
  readonly state: ProjectState;
  readonly set: Setter<CutDraft>;
}): ReactNode {
  const { groups } = state.gameAudio ?? NO_GAME_AUDIO;
  const { choices, chosen } = destinationChoices(fields, state);
  const destination = fields.destination.value;
  return (
    <div className="ag-workflow-pair">
      <SourcedChoice
        label="Put the sounds in"
        field={{ value: chosen, source: fields.destination.source }}
        choices={choices}
        onChoose={(value) => {
          const group = [...groups.keys()].find((id) => id === value);
          if (group !== undefined) set('destination', { kind: 'group', group });
          else if (value === NEW_GROUP) set('destination', { kind: 'new', path: '' });
        }}
      />
      {destination.kind === 'new' && (
        <SourcedText
          label="New group"
          description="Its name, or a path with a / between a group and the one inside it, such as Footsteps/Grass. The groups the project lacks are made in the same step."
          field={{ value: destination.path, source: fields.destination.source }}
          onText={(path) => {
            set('destination', { kind: 'new', path });
          }}
        />
      )}
    </div>
  );
}

export function CutOptions({
  fields,
  state,
  onDraft,
}: {
  readonly fields: DraftFields<CutDraft>;
  readonly state: ProjectState;
  readonly onDraft: DraftChange;
}): ReactNode {
  const set: Setter<CutDraft> = (field, value) => {
    onDraft((now) =>
      now.key === 'cut-into-sounds'
        ? { key: now.key, fields: withChosen(now.fields, field, value) }
        : now,
    );
  };
  const optional = (label: string, unit: WorkflowUnit, field: 'threshold' | 'shortestPause') => (
    <SourcedOptionalNumber
      label={label}
      unit={unit}
      field={fields[field]}
      onNumber={(value) => {
        set(field, value);
      }}
    />
  );
  return (
    <>
      <Destination fields={fields} state={state} set={set} />
      <SourcedText
        label="Naming"
        template={NAMING_FIELD}
        field={fields.naming}
        onText={(value) => {
          set('naming', value);
        }}
      />
      <NumberRows
        rows={(['leadInMilliseconds', 'tailMilliseconds'] as const).map((field) => ({
          label: field === 'leadInMilliseconds' ? 'Lead-in' : 'Tail',
          unit: UNITS.milliseconds,
          field: fields[field],
          set: (value: number) => {
            set(field, value);
          },
        }))}
      >
        {optional('Silence threshold', UNITS.dbfs, 'threshold')}
        {optional('Shortest pause between sounds', UNITS.seconds, 'shortestPause')}
      </NumberRows>
    </>
  );
}
