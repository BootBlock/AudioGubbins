/**
 * The question put to the person when a file the open project links to is no
 * longer what the project recorded (REQ-STOR-053, REQ-STOR-104).
 *
 * Each changed file is named with what became of it, and offered the media
 * store's choices in its order, after leave to read it where the browser needs
 * the person's: take the new version, link another file, keep playing the copy
 * kept of the version the project was made with, or keep the asset offline. A
 * choice that cannot be taken is shown with the reason rather than left out.
 * Beside them, what the asset does the next time its file changes: ask, take
 * the new version, or keep the version the project used where a copy of it is
 * kept, the asset's own policy (REQ-STOR-053). What an asset's own policy did
 * without asking is said too. Closing the question decides later, and leaves
 * every asset offline.
 */

import { useSyncExternalStore, type ReactNode } from 'react';

import {
  Button,
  Icon,
  ModalDialog,
  OptionSelect,
  type IconName,
} from '@audiogubbins/design-system';
import type { AssetId } from '@audiogubbins/domain';
import type {
  ResolutionChoice,
  ResolutionKind,
  SourceClassification,
} from '@audiogubbins/media-store';
import { SourceChangePolicy, type MediaSource } from '@audiogubbins/project-format';

import type { Observable } from '../state/observable.js';
import type { OpenProjectState } from '../state/open-project-store.js';
import { wantsLeave, type SourceChange, type SourceChangeState } from '../state/source-changes.js';
import { offeredSentence } from '../commands/source-commands.js';
import type { RunCommand } from './settings/section.js';
import { quoted } from '@audiogubbins/text';

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

/** How a changed file is marked: its glyph, and the tone its card takes. */
interface ChangeMark {
  readonly icon: IconName;
  readonly tone: 'accent' | 'warning' | 'error' | 'success';
}

/** The mark of what became of a file. */
function markOf(classification: SourceClassification): ChangeMark {
  switch (classification.kind) {
    case 'unchanged':
      return { icon: 'success', tone: 'success' };
    case 'modified':
      return { icon: 'changed-file', tone: 'warning' };
    case 'replaced':
    case 'relinked-identical':
      return { icon: 'replaced-file', tone: 'accent' };
    case 'missing':
      switch (classification.reason) {
        case 'access-needed':
          return { icon: 'needs-access', tone: 'accent' };
        case 'permission-refused':
          return { icon: 'needs-access', tone: 'error' };
        case 'not-found':
        case 'unreadable':
          return { icon: 'missing-file', tone: 'error' };
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

/** What each policy is called where the person chooses it. */
const POLICY_LABELS: Readonly<Record<SourceChangePolicy, string>> = {
  prompt: 'Ask me',
  adopt: 'Use the new version',
  freeze: 'Keep the version the project used',
};

/** What a linked asset does the next time its file changes, and the choice of it. */
function NextTime({
  asset,
  media,
  run,
}: {
  readonly asset: AssetId;
  readonly media: MediaSource | undefined;
  readonly run: RunCommand;
}): ReactNode {
  if (media?.kind !== 'external') return null;
  const keepsCopy = media.retainedCopy !== undefined;
  const options = Object.values(SourceChangePolicy)
    .filter((policy) => keepsCopy || policy !== SourceChangePolicy.Freeze)
    .map((policy) => ({ value: policy, label: POLICY_LABELS[policy] }));
  return (
    <>
      <div className="ag-source-change-policy">
        <OptionSelect
          label="The next time its file changes"
          value={media.policy}
          options={options}
          onValueChange={(policy) => run('source.set-policy', { asset, policy })}
        />
      </div>
      {!keepsCopy && (
        <p className="ag-dialogue-note">
          Keeping the version the project used needs a copy of it, which this asset does not keep.
        </p>
      )}
    </>
  );
}

/** The choices for one changed file, each a button, and why any cannot be taken. */
function FileChoices({
  change,
  name,
  run,
}: {
  readonly change: SourceChange;

  /** The file's name, quoted. */
  readonly name: string;
  readonly run: RunCommand;
}): ReactNode {
  const { offered } = change;
  const reasons = [...new Set(change.plan.choices.flatMap((choice) => reasonOf(choice) ?? []))];
  return (
    <>
      <div className="ag-dialogue-row" role="group" aria-label={`What to do about ${name}`}>
        {wantsLeave(change.classification) ? (
          <Button onClick={() => run('source.give-access', { asset: change.asset })}>
            <Icon name="give-access" />
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
        {change.plan.choices.map((choice) => {
          const reason = reasonOf(choice);
          return (
            <Button
              key={choice.kind}
              {...(reason === undefined ? {} : { unavailableReason: reason })}
              onClick={() => run('source.resolve', { asset: change.asset, choice: choice.kind })}
            >
              {CHOICE_LABELS[choice.kind]}
            </Button>
          );
        })}
      </div>
      {/* Shown under the buttons as well as held by the one it stops, so the
          reader sees why before reaching for it. Hidden from a screen
          reader, which hears it as that button's description. */}
      {reasons.map((reason) => (
        <p key={reason} className="ag-dialogue-note" aria-hidden="true">
          {reason}
        </p>
      ))}
    </>
  );
}

/** One changed file, its choices, and what it does the next time. */
function ChangedFile({
  change,
  media,
  run,
}: {
  readonly change: SourceChange;
  readonly media: MediaSource | undefined;
  readonly run: RunCommand;
}): ReactNode {
  const name = quoted(change.name);
  const { offered } = change;
  const mark = markOf(change.classification);
  return (
    <li className="ag-source-change" data-ag-tone={mark.tone}>
      <span className="ag-source-change-mark">
        <Icon name={mark.icon} />
      </span>
      <div className="ag-source-change-body">
        <p className="ag-dialogue-text">{whatBecame(change.classification, name)}</p>
        {offered === undefined ? undefined : (
          <p className="ag-dialogue-note">{offeredSentence(offered)}</p>
        )}
        <FileChoices change={change} name={name} run={run} />
        <NextTime asset={change.asset} media={media} run={run} />
      </div>
    </li>
  );
}

/** The question (see the module comment). */
export function SourceChangePrompt({
  sources,
  project,
  run,
}: {
  readonly sources: Observable<SourceChangeState>;

  /** The open project, whose assets say what each does the next time. */
  readonly project: Observable<OpenProjectState>;
  readonly run: RunCommand;
}): ReactNode {
  const state = useSyncExternalStore(sources.subscribe, sources.get);
  const open = useSyncExternalStore(project.subscribe, project.get);
  const held = open.kind === 'open' ? open.snapshot.model.state.sources : undefined;
  return (
    <ModalDialog
      open={state.changes.length > 0 || state.applied.length > 0}
      onOpenChange={(open) => {
        if (!open) run('source.decide-later');
      }}
      title="Linked files have changed"
      icon="linked-files-changed"
      description="Some files this project links to are not what it last used. Choose what to do about each."
      closeLabel="Close"
    >
      <ul className="ag-source-changes">
        {state.changes.map((change) => (
          <ChangedFile
            key={change.asset}
            change={change}
            media={held?.get(change.asset)?.media}
            run={run}
          />
        ))}
      </ul>
      {state.applied.map((done) => (
        <p key={done.asset} className="ag-dialogue-note">
          {`${quoted(done.name)} was dealt with as its own setting says: ${CHOICE_LABELS[done.kind].toLowerCase()}.`}
        </p>
      ))}
    </ModalDialog>
  );
}
