/**
 * One entry of the Library panel: a saved chain, a preset, or an entry this
 * version cannot use, with what can be done with it, each a library command.
 *
 * A chain is applied to the selection of the editor in use, or to several
 * targets ticked here (`target-chooser.tsx`), as a copy each or one chain
 * shared (REQ-EDIT-014); a preset to the processor selected. Renaming and
 * removing open in the row (`entry-changes.tsx`), and the focus goes back to
 * what opened each as it closes (`row-opening.ts`).
 */

import { useId, useState, type ReactNode } from 'react';

import { Button, ToggleSwitch } from '@audiogubbins/design-system';
import type { LibraryEntry } from '@audiogubbins/domain';
import type { ListedEntry } from '@audiogubbins/storage';
import { quoted } from '@audiogubbins/text';

import type { OpenProjectState } from '../../state/open-project-store.js';
import { when } from '../../wording.js';
import { CommandButton, type PanelCommands } from '../command-button.js';
import { RemoveConfirmation, RenameField } from './entry-changes.js';
import { processorWords, slotsWords } from './library-words.js';
import { useOpening, type Opening, type Part } from './row-opening.js';
import { TargetChooser } from './target-chooser.js';

/** The editor in use, and the name of what it shows, which a chain or preset is applied in. */
export interface Shown {
  readonly panel: string;
  readonly name: string;
}

/** Why applying cannot run while no editor shows the project's audio. */
const NOTHING_SHOWN = 'Open audio of the project in an editor to apply it there.';

/** The control that opens one part of a row. */
function Opener({
  part,
  opening,
  children,
}: {
  readonly part: Part;
  readonly opening: Opening;
  readonly children: string;
}): ReactNode {
  return (
    <Button
      compact
      ref={opening.opener(part)}
      onClick={() => {
        opening.show(part);
      }}
    >
      {children}
    </Button>
  );
}

/** Applying an entry where the editor in use shows: a chain shared or not, or a preset. */
function Applying({
  entry,
  shown,
  share,
  onShare,
  opening,
  commands,
}: {
  readonly entry: LibraryEntry;
  readonly shown: Shown | undefined;
  readonly share: boolean;
  readonly onShare: (share: boolean) => void;
  readonly opening: Opening;
  readonly commands: PanelCommands;
}): ReactNode {
  const where = shown === undefined ? {} : { view: shown.panel };
  const refusal = shown === undefined ? NOTHING_SHOWN : undefined;
  if (entry.content.kind === 'preset') {
    return (
      <CommandButton
        id="library.apply-preset"
        label="Apply to the selected processor"
        commands={commands}
        args={{ entry: entry.id, ...where }}
        refusal={refusal}
      />
    );
  }
  return (
    <>
      <ToggleSwitch
        label="Share one chain"
        description="Every target names one copy, so a later change to it reaches them all. Off, each gets a copy of its own."
        checked={share}
        onCheckedChange={onShare}
      />
      <CommandButton
        id="library.apply-chain"
        label={shown === undefined ? 'Apply' : `Apply to ${quoted(shown.name)}`}
        commands={commands}
        args={{ entry: entry.id, ...where, share }}
        refusal={refusal}
      />
      <Opener part="targets" opening={opening}>
        Apply to several…
      </Opener>
    </>
  );
}

/** The part of a usable entry's row that is open, where one is. */
function OpenPart({
  entry,
  share,
  project,
  opening,
  commands,
  onRemoving,
}: {
  readonly entry: LibraryEntry;
  readonly share: boolean;
  readonly project: OpenProjectState;
  readonly opening: Opening;
  readonly commands: PanelCommands;
  readonly onRemoving: () => void;
}): ReactNode {
  switch (opening.open) {
    case 'targets':
      return (
        <TargetChooser
          entry={entry}
          share={share}
          project={project}
          commands={commands}
          onClose={opening.close}
        />
      );
    case 'rename':
      return <RenameField entry={entry} commands={commands} onClose={opening.close} />;
    case 'remove':
      return (
        <RemoveConfirmation
          id={entry.id}
          name={quoted(entry.name)}
          commands={commands}
          onKeep={opening.close}
          onRemoving={onRemoving}
        />
      );
    case undefined:
      return null;
  }
}

/** A saved chain or preset this version can use, and what can be done with it. */
function UsableEntry({
  entry,
  shown,
  project,
  commands,
  onRemoving,
}: {
  readonly entry: LibraryEntry;
  readonly shown: Shown | undefined;
  readonly project: OpenProjectState;
  readonly commands: PanelCommands;
  readonly onRemoving: () => void;
}): ReactNode {
  const heading = useId();
  const [share, setShare] = useState(false);
  const opening = useOpening();
  const { content } = entry;
  const holds =
    content.kind === 'chain'
      ? `Holds ${slotsWords(content.chain.slots)}.`
      : `The settings of a ${processorWords(content.processor)}.`;
  return (
    <li className="ag-library-entry" role="group" aria-labelledby={heading}>
      <h4 className="ag-library-entry-name" id={heading}>
        {entry.name}
      </h4>
      <p className="ag-panel-note">{`Saved ${when(entry.savedAt)}. ${holds}`}</p>
      <Applying
        entry={entry}
        shown={shown}
        share={share}
        onShare={setShare}
        opening={opening}
        commands={commands}
      />
      <Opener part="rename" opening={opening}>
        Rename…
      </Opener>
      <Opener part="remove" opening={opening}>
        Remove…
      </Opener>
      <OpenPart
        entry={entry}
        share={share}
        project={project}
        opening={opening}
        commands={commands}
        onRemoving={onRemoving}
      />
    </li>
  );
}

/** An entry this version cannot use: the reason, and its removal. */
function UnusableEntry({
  listed,
  commands,
  onRemoving,
}: {
  readonly listed: Extract<ListedEntry, { readonly kind: 'unusable' }>;
  readonly commands: PanelCommands;
  readonly onRemoving: () => void;
}): ReactNode {
  const heading = useId();
  const opening = useOpening();
  const name = listed.entry === undefined ? 'An entry that cannot be read' : listed.entry.name;
  return (
    <li className="ag-library-entry" role="group" aria-labelledby={heading}>
      <h4 className="ag-library-entry-name" id={heading}>
        {name}
      </h4>
      <p data-ag-status="unavailable">{listed.reason.summary}</p>
      <Opener part="remove" opening={opening}>
        Remove…
      </Opener>
      {opening.open === 'remove' && (
        <RemoveConfirmation
          id={listed.id}
          name={listed.entry === undefined ? 'this entry' : quoted(listed.entry.name)}
          commands={commands}
          onKeep={opening.close}
          onRemoving={onRemoving}
        />
      )}
    </li>
  );
}

/** One entry of the library, usable or not. */
export function LibraryEntryRow({
  listed,
  shown,
  project,
  commands,
  onRemoving,
}: {
  readonly listed: ListedEntry;
  readonly shown: Shown | undefined;
  readonly project: OpenProjectState;
  readonly commands: PanelCommands;
  /** Takes the focus to where it stays once this entry is removed. */
  readonly onRemoving: () => void;
}): ReactNode {
  return listed.kind === 'usable' ? (
    <UsableEntry
      entry={listed.entry}
      shown={shown}
      project={project}
      commands={commands}
      onRemoving={onRemoving}
    />
  ) : (
    <UnusableEntry listed={listed} commands={commands} onRemoving={onRemoving} />
  );
}
