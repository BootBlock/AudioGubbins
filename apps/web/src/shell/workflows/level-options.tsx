/**
 * Normalise Game SFX's and Clean Dialogue's options (ADR-0105): the loudness
 * target the groups are set to, where one is asked for, and where a sound
 * that inherits its group's processing has its level and its treatment.
 */

import type { ReactNode } from 'react';

import type { LoudnessTarget } from '@audiogubbins/game-audio';
import type { CleanDialogueOptions, NormaliseGameSfxOptions } from '@audiogubbins/guided-workflows';

import { withChosen, type DraftFields, type DraftSource } from '../../state/workflow-drafts.js';
import {
  NumberRows,
  PlacementChoice,
  type DraftChange,
  type NumberRow,
  type Setter,
} from './option-rows.js';
import { SourcedSwitch } from './workflow-fields.js';

/** The loudness target a group is given once the person asks to set one. */
const OFFERED_TARGET: LoudnessTarget = {
  integratedLufs: -16,
  toleranceLu: 1,
  truePeakCeilingDbtp: -1,
};

/** The target's values as rows, each setting the target with its value changed. */
function targetRows(
  target: LoudnessTarget,
  source: DraftSource,
  set: (target: LoudnessTarget) => void,
): readonly NumberRow[] {
  const row = (
    label: string,
    unit: string,
    value: number,
    to: (value: number) => LoudnessTarget,
  ) => ({
    label,
    unit,
    field: { value, source },
    set: (value: number) => {
      set(to(value));
    },
  });
  return [
    row('Integrated loudness', 'LUFS', target.integratedLufs, (integratedLufs) => ({
      ...target,
      integratedLufs,
    })),
    row('Tolerance', 'LU', target.toleranceLu, (toleranceLu) => ({ ...target, toleranceLu })),
    row('True-peak ceiling', 'dBTP', target.truePeakCeilingDbtp ?? -1, (truePeakCeilingDbtp) => ({
      ...target,
      truePeakCeilingDbtp,
    })),
  ];
}

export function NormaliseOptions({
  fields,
  onDraft,
}: {
  readonly fields: DraftFields<NormaliseGameSfxOptions>;
  readonly onDraft: DraftChange;
}): ReactNode {
  const set: Setter<NormaliseGameSfxOptions> = (field, value) => {
    onDraft((now) =>
      now.key === 'normalise-game-sfx'
        ? { key: now.key, fields: withChosen(now.fields, field, value) }
        : now,
    );
  };
  const { value: target, source } = fields.loudness;
  return (
    <>
      <SourcedSwitch
        label="Set the groups’ loudness target"
        description="Off, each sound is normalised to the target its policy already gives it."
        field={{ value: target !== undefined, source }}
        onSwitch={(on) => {
          set('loudness', on ? OFFERED_TARGET : undefined);
        }}
      />
      {target !== undefined && (
        <NumberRows
          rows={targetRows(target, source, (to) => {
            set('loudness', to);
          })}
        />
      )}
      <PlacementChoice
        field={fields.placement}
        set={(value) => {
          set('placement', value);
        }}
      />
    </>
  );
}

export function DialogueOptions({
  fields,
  onDraft,
}: {
  readonly fields: DraftFields<CleanDialogueOptions>;
  readonly onDraft: DraftChange;
}): ReactNode {
  return (
    <PlacementChoice
      field={fields.placement}
      set={(value) => {
        onDraft((now) =>
          now.key === 'clean-dialogue'
            ? { key: now.key, fields: withChosen(now.fields, 'placement', value) }
            : now,
        );
      }}
    />
  );
}
