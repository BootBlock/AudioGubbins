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

import {
  Button,
  ButtonTone,
  Hint,
  Icon,
  IconButton,
  IconSize,
  ToggleSwitch,
  VisuallyHidden,
  type IconName,
} from '@audiogubbins/design-system';
import type { ChainSlot, LibraryEntry } from '@audiogubbins/domain';
import { BUILT_IN_LIBRARY, PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import type { LibraryListing } from '@audiogubbins/storage';
import { quoted } from '@audiogubbins/text';

import type { OpenProjectState } from '../../state/open-project-store.js';
import { when } from '../../wording.js';
import { CommandAction } from '../command-action.js';
import type { PanelCommands } from '../command-button.js';
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

/** The glyph each built-in chain is drawn with, in the order the library lists them. */
const BUILT_IN_GLYPHS: readonly IconName[] = [
  'game-sound',
  'interface-sound',
  'dialogue',
  'seamless-loop',
  'impact-sound',
];

/** Each built-in chain's glyph, by its identity. */
const GLYPHS_BY_ENTRY: ReadonlyMap<string, IconName> = new Map(
  BUILT_IN_LIBRARY.flatMap((entry, index) => {
    const glyph = BUILT_IN_GLYPHS[index];
    return glyph === undefined ? [] : [[entry.id, glyph] as const];
  }),
);

/** The glyph an entry is drawn with: its own where it is built in, else its kind's. */
function glyphOf(entry: LibraryEntry): IconName {
  return (
    GLYPHS_BY_ENTRY.get(entry.id) ?? (entry.content.kind === 'preset' ? 'preset' : 'saved-chain')
  );
}

/** The control that opens one part of a row, drawn as its glyph. */
function Opener({
  part,
  opening,
  icon,
  label,
}: {
  readonly part: Part;
  readonly opening: Opening;
  readonly icon: IconName;
  readonly label: string;
}): ReactNode {
  return (
    <IconButton
      icon={icon}
      label={label}
      compact
      {...(part === 'remove' ? { tone: ButtonTone.QuietDestructive } : {})}
      ref={opening.opener(part)}
      onClick={() => {
        opening.show(part);
      }}
    />
  );
}

/** The processors a chain runs, in order, as chips: what a built-in chain holds at a glance. */
function ChainChips({ slots }: { readonly slots: readonly ChainSlot[] }): ReactNode {
  return (
    // The sentence the entry carries says what it holds; this draws it.
    <ol className="ag-library-chain" aria-hidden="true">
      {slots.map((slot, index) => (
        <li key={slot.id} className="ag-library-chip" data-ag-off={slot.enabled ? undefined : ''}>
          {index > 0 && <Icon name="chain-next" size={IconSize.Small} />}
          <span className="ag-library-chip-name">
            {slot.kind === 'processor'
              ? (PROCESSOR_CATALOGUE.get(slot.typeKey)?.label ?? slot.typeKey)
              : 'Parallel group'}
          </span>
        </li>
      ))}
    </ol>
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
      <div className="ag-library-apply">
        <CommandAction
          id="library.apply-preset"
          label="Apply to the selected processor"
          commands={commands}
          args={{ entry: entry.id, ...where }}
          refusal={refusal}
          tone={ButtonTone.Primary}
        />
      </div>
    );
  }
  return (
    <div className="ag-library-apply">
      <span className="ag-library-share">
        <ToggleSwitch label="Share one chain" checked={share} onCheckedChange={onShare} small />
        <Hint label="About sharing one chain">
          <p>
            Every target names one copy, so a later change to it reaches them all. Off, each gets a
            copy of its own.
          </p>
        </Hint>
      </span>
      <Button
        compact
        tone={ButtonTone.Quiet}
        ref={opening.opener('targets')}
        onClick={() => {
          opening.show('targets');
        }}
      >
        Apply to several…
      </Button>
      <CommandAction
        id="library.apply-chain"
        label={shown === undefined ? 'Apply' : `Apply to ${quoted(shown.name)}`}
        commands={commands}
        args={{ entry: entry.id, ...where, share }}
        refusal={refusal}
        tone={ButtonTone.Primary}
      />
    </div>
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

/** The head of an entry's row: its glyph, its name, a line on it, and the controls that change it. */
function EntryHead({
  heading,
  glyph,
  name,
  detail,
  tools,
}: {
  readonly heading: string;
  readonly glyph: IconName;
  readonly name: string;
  readonly detail: ReactNode;
  readonly tools?: ReactNode;
}): ReactNode {
  return (
    <div className="ag-library-entry-head">
      <span className="ag-library-glyph">
        <Icon name={glyph} />
      </span>
      <div className="ag-library-entry-text">
        <h4 className="ag-library-entry-name" id={heading}>
          {name}
        </h4>
        {detail}
      </div>
      {tools !== undefined && <span className="ag-library-entry-tools">{tools}</span>}
    </div>
  );
}

/** A saved chain or preset this version can use, and what can be done with it. */
function UsableEntry({
  entry,
  builtIn,
  shown,
  project,
  commands,
  onRemoving,
}: {
  readonly entry: LibraryEntry;
  /** Whether it comes with AudioGubbins, which is applied and never renamed or removed. */
  readonly builtIn: boolean;
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
  // Built in, it says so in a word and draws what it holds as chips; the
  // whole of it stays in the sentence a screen reader reads.
  const detail = builtIn ? (
    <p className="ag-library-entry-detail">
      Built in
      <VisuallyHidden>{`: it comes with AudioGubbins, so it is not renamed or removed. ${holds}`}</VisuallyHidden>
    </p>
  ) : (
    <p className="ag-library-entry-detail">{`Saved ${when(entry.savedAt)}. ${holds}`}</p>
  );
  return (
    <li className="ag-library-entry" role="group" aria-labelledby={heading}>
      <EntryHead
        heading={heading}
        glyph={glyphOf(entry)}
        name={entry.name}
        detail={detail}
        {...(builtIn
          ? {}
          : {
              tools: (
                <>
                  <Opener part="rename" opening={opening} icon="change" label="Rename…" />
                  <Opener part="remove" opening={opening} icon="delete" label="Remove…" />
                </>
              ),
            })}
      />
      {builtIn && content.kind === 'chain' && <ChainChips slots={content.chain.slots} />}
      <Applying
        entry={entry}
        shown={shown}
        share={share}
        onShare={setShare}
        opening={opening}
        commands={commands}
      />
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
  readonly listed: Extract<LibraryListing, { readonly kind: 'unusable' }>;
  readonly commands: PanelCommands;
  readonly onRemoving: () => void;
}): ReactNode {
  const heading = useId();
  const opening = useOpening();
  const name = listed.entry === undefined ? 'An entry that cannot be read' : listed.entry.name;
  return (
    <li className="ag-library-entry" role="group" aria-labelledby={heading} data-ag-refused="">
      <EntryHead
        heading={heading}
        glyph="unreadable-project"
        name={name}
        detail={<p className="ag-library-entry-detail">{listed.reason.summary}</p>}
        tools={<Opener part="remove" opening={opening} icon="delete" label="Remove…" />}
      />
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
  readonly listed: LibraryListing;
  readonly shown: Shown | undefined;
  readonly project: OpenProjectState;
  readonly commands: PanelCommands;
  /** Takes the focus to where it stays once this entry is removed. */
  readonly onRemoving: () => void;
}): ReactNode {
  return listed.kind === 'usable' ? (
    <UsableEntry
      entry={listed.entry}
      builtIn={listed.builtIn}
      shown={shown}
      project={project}
      commands={commands}
      onRemoving={onRemoving}
    />
  ) : (
    <UnusableEntry listed={listed} commands={commands} onRemoving={onRemoving} />
  );
}
