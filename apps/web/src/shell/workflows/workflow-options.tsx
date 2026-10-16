/**
 * A workflow's options in its dialog (ADR-0105), each at its default with
 * where that default came from, as the person sets them. Every change is the
 * draft's, through the dialog's store; nothing here changes the project.
 * Create Seamless Loop's choice of loop points is `loop-choices.tsx`.
 */

import type { ReactNode } from 'react';

import type { ProjectState } from '@audiogubbins/project-format';

import { withChosen, type WorkflowDraft } from '../../state/workflow-drafts.js';
import { CutOptions } from './cut-options.js';
import { GodotOptions } from './godot-options.js';
import { DialogueOptions, NormaliseOptions } from './level-options.js';
import { OneShotOptions } from './one-shot-options.js';
import type { DraftChange } from './option-rows.js';
import { SourcedSwitch } from './workflow-fields.js';

export function WorkflowOptions({
  draft,
  state,
  onDraft,
}: {
  readonly draft: WorkflowDraft;
  readonly state: ProjectState;
  readonly onDraft: DraftChange;
}): ReactNode {
  switch (draft.key) {
    case 'cut-into-sounds':
      return <CutOptions fields={draft.fields} state={state} onDraft={onDraft} />;
    case 'prepare-one-shot':
      return <OneShotOptions fields={draft.fields} onDraft={onDraft} />;
    case 'normalise-game-sfx':
      return <NormaliseOptions fields={draft.fields} onDraft={onDraft} />;
    case 'clean-dialogue':
      return <DialogueOptions fields={draft.fields} onDraft={onDraft} />;
    case 'export-for-godot':
      return <GodotOptions fields={draft.fields} onDraft={onDraft} />;
    case 'create-seamless-loop':
      return (
        <SourcedSwitch
          label="End each region at its loop’s end"
          description="So nothing plays after the loop once it stops."
          field={draft.fields.endAtLoopEnd}
          onSwitch={(value) => {
            onDraft((now) =>
              now.key === 'create-seamless-loop'
                ? { key: now.key, fields: withChosen(now.fields, 'endAtLoopEnd', value) }
                : now,
            );
          }}
        />
      );
  }
}
