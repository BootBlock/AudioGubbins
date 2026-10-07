/**
 * The Library panel (ADR-0060, REQ-AUDIO-017, REQ-EDIT-012, REQ-EDIT-014): the
 * person's saved chains and presets, by kind, each with its name, when it was
 * saved and what it holds, and every entry this version cannot use, with the
 * reason. A chain is applied to the selection of the editor in use, or the
 * whole of what it shows with nothing selected, or to several targets chosen
 * here, a copy each or one chain shared; a preset to the processor selected;
 * either renamed or removed, removal asked a second time.
 *
 * Every action is the library's command of that name; the panel holds only what
 * a person is in the middle of choosing (a name typed, the targets ticked,
 * whether to share) and writes no store (`CLAUDE.md` G2). The list is the
 * library's, which other tabs change too, kept up to date by its store; each
 * entry is keyed by its identity, so a change redraws the entries it touched
 * and leaves the rest, and the person's place, where they were.
 */

import { useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

import { TextField } from '@audiogubbins/design-system';
import type { LibraryEntry } from '@audiogubbins/domain';
import type { ListedEntry } from '@audiogubbins/storage';
import { quoted } from '@audiogubbins/text';

import type { EditorPanelParts } from '../../editor/panel-parts.js';
import type { AssetCatalogue } from '../../state/asset-catalogue.js';
import type { Observable } from '../../state/observable.js';
import type { OpenProjectState } from '../../state/open-project-store.js';
import type { SavedProcessingState } from '../../state/saved-processing-store.js';
import { CommandButton, type PanelCommands } from '../command-button.js';
import { LibraryEntryRow, type Shown } from './library-entry.js';

/** The person's library and the project open here, which the panel reads. */
export interface LibraryStores {
  readonly savedProcessing: Observable<SavedProcessingState>;
  readonly project: Observable<OpenProjectState>;
}

/** What the Library panel reads. */
export interface LibraryParts {
  /** The library and the project, absent where this browser keeps no projects. */
  readonly library: LibraryStores | undefined;
  /** Why projects cannot be reached now, said in the library's place, where it is absent. */
  readonly unavailable: string | undefined;
  readonly editorViews: EditorPanelParts['stores']['editorViews'];
  readonly assets: Pick<AssetCatalogue, 'get' | 'subscribe' | 'find'>;
}

/** The editor last in use, and what it shows, where it shows something of the project. */
function useShown(parts: Pick<LibraryParts, 'editorViews' | 'assets'>): Shown | undefined {
  const { editorViews, assets } = parts;
  const views = useSyncExternalStore(editorViews.subscribe, editorViews.get);
  useSyncExternalStore(assets.subscribe, assets.get);
  const panel = views.focused;
  const entry = panel === undefined ? undefined : editorViews.entry(panel);
  const asset = entry === undefined ? undefined : assets.find(entry.asset);
  if (panel === undefined || asset?.owner.kind !== 'project') return undefined;
  const { owner } = asset;
  return { panel, name: owner.region?.displayName ?? owner.asset.displayName };
}

/** Saving the rack of what the editor in use shows, under a name typed here. */
function SaveRack({
  shown,
  commands,
}: {
  readonly shown: Shown | undefined;
  readonly commands: PanelCommands;
}): ReactNode {
  const [name, setName] = useState('');
  const what = shown === undefined ? 'the asset or region shown' : quoted(shown.name);
  const refusal =
    shown === undefined
      ? 'Open audio of the project in an editor to save its rack.'
      : name.trim() === ''
        ? 'Type the name to save it under.'
        : undefined;
  return (
    <div className="ag-library-save">
      <TextField label={`Save the rack of ${what} as`} value={name} onValueChange={setName} />
      <CommandButton
        id="library.save-chain"
        label="Save the rack"
        commands={commands}
        args={shown === undefined ? { name } : { view: shown.panel, name }}
        refusal={refusal}
      />
    </div>
  );
}

/** One kind of entry: its heading and its entries, each keyed by its identity. */
function EntryList({
  heading,
  entries,
  shown,
  project,
  commands,
}: {
  readonly heading: string;
  readonly entries: readonly ListedEntry[];
  readonly shown: Shown | undefined;
  readonly project: OpenProjectState;
  readonly commands: PanelCommands;
}): ReactNode {
  const id = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  if (entries.length === 0) return null;
  return (
    <div className="ag-library-kind" role="group" aria-labelledby={id}>
      <h3 className="ag-section-heading" id={id} ref={headingRef} tabIndex={-1}>
        {`${heading} (${String(entries.length)})`}
      </h3>
      <ul className="ag-library-entries">
        {entries.map((listed) => (
          <LibraryEntryRow
            key={listed.kind === 'usable' ? listed.entry.id : listed.id}
            listed={listed}
            shown={shown}
            project={project}
            commands={commands}
            onRemoving={() => headingRef.current?.focus()}
          />
        ))}
      </ul>
    </div>
  );
}

/** The usable entries whose content is of `kind`. */
function ofKind(entries: readonly ListedEntry[], kind: LibraryEntry['content']['kind']) {
  return entries.filter((listed) => listed.kind === 'usable' && listed.entry.content.kind === kind);
}

/** What the library holds, and what can be done with it. */
function LibraryContents({
  library,
  parts,
  commands,
}: {
  readonly library: LibraryStores;
  readonly parts: LibraryParts;
  readonly commands: PanelCommands;
}): ReactNode {
  const saved = useSyncExternalStore(
    library.savedProcessing.subscribe,
    library.savedProcessing.get,
  );
  const project = useSyncExternalStore(library.project.subscribe, library.project.get);
  const shown = useShown(parts);
  const { entries } = saved;
  const lists: readonly (readonly [string, readonly ListedEntry[]])[] = [
    ['Saved chains', ofKind(entries, 'chain')],
    ['Presets', ofKind(entries, 'preset')],
    ['Cannot be used in this version', entries.filter((listed) => listed.kind === 'unusable')],
  ];
  return (
    <>
      {shown === undefined ? (
        <p>Open audio of the project in an editor to apply a chain or a preset to it.</p>
      ) : (
        <p className="ag-panel-note">
          {`A chain is applied to what is selected in ${quoted(shown.name)}, or to all of it with nothing selected.`}
        </p>
      )}
      <SaveRack shown={shown} commands={commands} />
      {saved.problem !== undefined && <p role="status">{saved.problem}</p>}
      {saved.loaded && entries.length === 0 && (
        <p>Nothing is saved yet. Save a rack here, or a processor’s settings from the rack.</p>
      )}
      {lists.map(([heading, listed]) => (
        <EntryList
          key={heading}
          heading={heading}
          entries={listed}
          shown={shown}
          project={project}
          commands={commands}
        />
      ))}
    </>
  );
}

/** The Library panel, or what is said in its place where this browser keeps no projects. */
export function LibraryPanel({
  title,
  parts,
  commands,
}: {
  readonly title: string;
  readonly parts: LibraryParts;
  readonly commands: PanelCommands;
}): ReactNode {
  return (
    <section className="ag-panel ag-library">
      <h2 className="ag-panel-title">{title}</h2>
      <p className="ag-panel-note">
        Your saved chains and presets, kept for every project. Applying one changes the project as
        one step you can undo; changing one here changes nothing it was applied to.
      </p>
      {parts.library === undefined ? (
        <p>{parts.unavailable ?? 'This browser cannot keep projects.'}</p>
      ) : (
        <LibraryContents library={parts.library} parts={parts} commands={commands} />
      )}
    </section>
  );
}
