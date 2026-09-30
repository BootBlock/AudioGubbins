/**
 * The question put to the person when a file the open project links to is no
 * longer what the project recorded (REQ-STOR-053, REQ-STOR-104).
 *
 * Each changed file is named with what became of it, and offered the media
 * store's choices in its order, after leave to read it where the browser needs
 * the person's: take the new version, link another file, keep playing the copy
 * kept of the version the project was made with, or keep the asset offline. A
 * choice that cannot be taken is shown with the reason rather than left out.
 * What an asset's own policy did without asking is said too. Closing the
 * question decides later, and leaves every asset offline.
 */

import { useSyncExternalStore, type ReactNode } from 'react';

import { Button, ModalDialog } from '@audiogubbins/design-system';
import type {
  ResolutionChoice,
  ResolutionKind,
  SourceClassification,
} from '@audiogubbins/media-store';

import type { Observable } from '../state/observable.js';
import { wantsLeave, type SourceChange, type SourceChangeState } from '../state/source-changes.js';
import { offeredSentence } from '../commands/source-commands.js';
import { quoted } from '../wording.js';
import { ReasonedButton } from './settings/reasoned-button.js';
import type { RunCommand } from './settings/section.js';

/** What became of a file, in a sentence. */
function whatBecame(classification: SourceClassification, name: string): string {
  switch (classification.kind) {
    case 'unchanged':
      return `The file of ${name} is as it was.`;
    case 'modified':
      return `The file of ${name} has been changed since the project last used it.`;
    case 'replaced':
      return `Another file now stands where the file of ${name} was.`;
    case 'relinked-identical':
      return `The file of ${name} has moved, and an identical copy was found.`;
    case 'missing':
      switch (classification.reason) {
        case 'access-needed':
          return `AudioGubbins needs your leave to read the file of ${name} again.`;
        case 'permission-refused':
          return `Leave to read the file of ${name} was refused.`;
        case 'not-found':
        case 'unreadable':
          return `The file of ${name} cannot be found.`;
      }
  }
}

/** What each choice is called on its button. */
const CHOICE_LABELS: Readonly<Record<ResolutionKind, string>> = {
  adopt: 'Use the new version',
  relink: 'Choose another file…',
  freeze: 'Keep the version the project used',
  'keep-offline': 'Keep it offline',
};

/** Why a choice cannot be taken, where it cannot. */
function reasonOf(choice: ResolutionChoice): string | undefined {
  return choice.available
    ? undefined
    : 'No copy of the version the project used was kept, so it cannot be kept playing.';
}

/** One changed file and its choices. */
function ChangedFile({
  change,
  run,
}: {
  readonly change: SourceChange;
  readonly run: RunCommand;
}): ReactNode {
  const name = quoted(change.name);
  const { offered } = change;
  return (
    <li className="ag-source-change">
      <p>{whatBecame(change.classification, name)}</p>
      {offered === undefined ? undefined : <p>{offeredSentence(offered)}</p>}
      <div className="ag-settings-row" role="group" aria-label={`What to do about ${name}`}>
        {wantsLeave(change.classification) ? (
          <Button onClick={() => run('source.give-access', { asset: change.asset })}>
            Give access
          </Button>
        ) : undefined}
        {offered === undefined ? undefined : (
          <Button onClick={() => run('source.link-offered', { asset: change.asset })}>
            {offered.identity.fileName === undefined
              ? 'Link the chosen file anyway'
              : `Link ${quoted(offered.identity.fileName)} anyway`}
          </Button>
        )}
        {change.plan.choices.map((choice) => (
          <ReasonedButton
            key={choice.kind}
            reason={reasonOf(choice)}
            onPress={() => run('source.resolve', { asset: change.asset, choice: choice.kind })}
          >
            {CHOICE_LABELS[choice.kind]}
          </ReasonedButton>
        ))}
      </div>
    </li>
  );
}

/** The question (see the module comment). */
export function SourceChangePrompt({
  sources,
  run,
}: {
  readonly sources: Observable<SourceChangeState>;
  readonly run: RunCommand;
}): ReactNode {
  const state = useSyncExternalStore(sources.subscribe, sources.get);
  return (
    <ModalDialog
      open={state.changes.length > 0 || state.applied.length > 0}
      onOpenChange={(open) => {
        if (!open) run('source.decide-later');
      }}
      title="Linked files have changed"
      description="Some files this project links to are not what it last used. Choose what to do about each."
    >
      <ul className="ag-source-changes">
        {state.changes.map((change) => (
          <ChangedFile key={change.asset} change={change} run={run} />
        ))}
      </ul>
      {state.applied.map((done) => (
        <p key={done.asset} className="ag-settings-note">
          {`${quoted(done.name)} was dealt with as its own setting says: ${CHOICE_LABELS[done.kind].toLowerCase()}.`}
        </p>
      ))}
    </ModalDialog>
  );
}
