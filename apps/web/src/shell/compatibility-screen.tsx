/**
 * The blocking screen for stored projects this version cannot read
 * (REQ-STOR-052).
 *
 * Before 1.0 nothing is migrated, so stored data of another version is kept
 * exactly as it is until the person decides. The screen says what was found and
 * offers three things: save a copy of the raw data, decide later, which leaves
 * every byte and makes projects unavailable until then, or remove it, which
 * asks a second time and says it cannot be undone before it is done. Closing
 * the screen is deciding later. Each decision runs a command.
 */

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

import { Button, ButtonTone, ModalDialog } from '@audiogubbins/design-system';

import type { StoredSchema } from '@audiogubbins/storage';

import type { Observable } from '../state/observable.js';
import type { BlockingData, StorageRootState } from '../state/storage-root-store.js';
import type { RunCommand } from './settings/section.js';

/** What each stored schema is called, as the screen names the format found. */
const SCHEMA_WORDS: Readonly<Record<StoredSchema, string>> = {
  projectStorage: 'storage format',
  projectDocument: 'project format',
};

/** What was found, in a sentence. */
function foundSentence(data: BlockingData): string {
  if (data.kind !== 'incompatible') {
    return 'The projects stored in this browser were saved in a format this version of AudioGubbins cannot recognise.';
  }
  const words = SCHEMA_WORDS[data.schema];
  return `The projects stored in this browser were saved in ${words} ${String(data.found)}, and this version of AudioGubbins reads ${words} ${String(data.current)}.`;
}

/**
 * The second confirmation of a wipe. Focus goes to keeping the data as it
 * appears, since the button pressed to reach it has gone, and keeping is the
 * choice that loses nothing.
 */
function WipeConfirmation({
  onKeep,
  run,
}: {
  readonly onKeep: () => void;
  readonly run: RunCommand;
}): ReactNode {
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    keep.current?.focus();
  }, []);
  return (
    <div className="ag-settings-section" role="group" aria-label="Remove the stored data">
      <p data-ag-status="unavailable">
        Removing the stored data deletes every project, backup and piece of media kept in this
        browser for good. Save a copy first if you might want any of it.
      </p>
      <div className="ag-settings-row">
        <Button
          tone={ButtonTone.Destructive}
          onClick={() => run('storage.wipe', { confirmed: 'yes' })}
        >
          Remove everything for good
        </Button>
        <Button ref={keep} onClick={onKeep}>
          Keep it
        </Button>
      </div>
    </div>
  );
}

/** The three decisions, the third behind its second confirmation. */
function Decisions({ run }: { readonly run: RunCommand }): ReactNode {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <WipeConfirmation
        onKeep={() => {
          setConfirming(false);
        }}
        run={run}
      />
    );
  }
  return (
    <div className="ag-settings-row">
      <Button tone={ButtonTone.Primary} onClick={() => run('storage.export-raw')}>
        Save a copy of the stored data
      </Button>
      <Button onClick={() => run('storage.set-aside')}>Decide later</Button>
      <Button
        tone={ButtonTone.Destructive}
        onClick={() => {
          setConfirming(true);
        }}
      >
        Remove the stored data…
      </Button>
    </div>
  );
}

/** The screen (see the module comment). */
export function CompatibilityScreen({
  root,
  run,
}: {
  readonly root: Observable<StorageRootState>;
  readonly run: RunCommand;
}): ReactNode {
  const state = useSyncExternalStore(root.subscribe, root.get);
  const blocked = state.kind === 'blocked' ? state : undefined;
  const working = blocked?.working;

  return (
    <ModalDialog
      open={blocked?.shown === true}
      onOpenChange={(open) => {
        if (!open) run('storage.set-aside');
      }}
      title="Your stored projects need a decision"
      description="This version of AudioGubbins cannot open the projects stored in this browser, and changes nothing until you decide."
    >
      <div className="ag-settings-section">
        {blocked !== undefined && <p>{foundSentence(blocked.data)}</p>}
        <p className="ag-settings-note">
          You can save a copy of the stored data to keep it safe, decide later and leave it as it
          is, or remove it and start afresh. Until you decide, no project can be made or opened
          here.
        </p>
        {working !== undefined && (
          <p role="status">
            {working === 'exporting'
              ? 'Saving a copy of the stored data…'
              : 'Removing the stored data…'}
          </p>
        )}
        <Decisions run={run} />
      </div>
    </ModalDialog>
  );
}
