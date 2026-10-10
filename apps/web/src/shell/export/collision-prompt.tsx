/**
 * The question put to the person when an export's file name is taken in the
 * folder it is delivered to and the rules ask (ADR-0092, REQ-ARCH-054): the
 * file named as the folder lists it, and what each answer does, said before
 * it is chosen. Keeping both comes first among the answers, so the first a
 * reader reaches changes nothing already there; replacing is never first.
 *
 * Each answer runs `export.answer-collision`, with whether it holds for the
 * rest of the batch where the batch has more files to come. Closing the
 * question skips the file, which stays staged, so it can be delivered
 * elsewhere without a new render.
 */

import { useId, useState, useSyncExternalStore, type ReactNode } from 'react';

import { Button, ModalDialog } from '@audiogubbins/design-system';
import { batchProgress, type CollisionAnswer } from '@audiogubbins/import-export';

import { ExportCommand } from '../../commands/import-export-ids.js';
import type { ExportRunState } from '../../export/export-types.js';
import { COLLISION_PROMPT_WORDS, collisionPromptTitle } from '../../import-export-words.js';
import type { Observable } from '../../state/observable.js';
import type { RunCommand } from '../settings/section.js';

/** What each answer does, in the order the buttons are read. */
const ANSWER_ORDER: readonly CollisionAnswer[] = ['rename', 'overwrite', 'skip'];

/** The question's description: what each answer does. */
const WHAT_EACH_DOES =
  'Keep both writes the export under a new name beside it. Replace writes over the file there. Skip leaves the folder as it is and keeps the export, so you can deliver it elsewhere.';

/** The question (see the module comment). */
export function CollisionPrompt({
  exports,
  run,
}: {
  readonly exports: Observable<ExportRunState>;
  readonly run: RunCommand;
}): ReactNode {
  const state = useSyncExternalStore(exports.subscribe, exports.get);
  const [forTheRest, setForTheRest] = useState(false);
  const checkbox = useId();
  const asking = state.kind === 'running' ? state.asking : undefined;
  const progress = state.kind === 'running' ? batchProgress(state.batch) : undefined;
  // The rest of the batch: the files after this one, still to settle.
  const more = progress !== undefined && progress.jobsTotal - progress.jobsSettled > 1;
  const answer = (choice: CollisionAnswer): void => {
    run(ExportCommand.AnswerCollision, { answer: choice, applyToAll: more && forTheRest });
    setForTheRest(false);
  };
  return (
    <ModalDialog
      open={asking !== undefined}
      onOpenChange={(open) => {
        if (open) return;
        run(ExportCommand.AnswerCollision);
        setForTheRest(false);
      }}
      title={collisionPromptTitle(asking ?? '')}
      description={WHAT_EACH_DOES}
      actions={ANSWER_ORDER.map((choice) => (
        <Button key={choice} onClick={() => answer(choice)}>
          {COLLISION_PROMPT_WORDS.answers[choice]}
        </Button>
      ))}
    >
      {more && (
        <div className="ag-settings-row">
          <input
            id={checkbox}
            type="checkbox"
            checked={forTheRest}
            onChange={(event) => setForTheRest(event.currentTarget.checked)}
          />
          <label htmlFor={checkbox}>{COLLISION_PROMPT_WORDS.forTheRest}</label>
        </div>
      )}
    </ModalDialog>
  );
}
