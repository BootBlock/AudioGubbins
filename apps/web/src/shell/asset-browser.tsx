/**
 * The Asset Browser panel: the open project's audio, each asset with its
 * regions under it in the project's order, any of them opened in the editor in
 * use with a press, and the control that imports a file and the one that calls
 * an import off (REQ-STOR-025, REQ-EDIT-014).
 *
 * An entry the page cannot open yet says why, as the editor view of it would.
 * The list follows the project and the catalogue, whose entries keep their
 * identity while nothing they are made from changes, and each row is keyed by
 * what it shows, so a change redraws its own row and leaves the rest, with the
 * focus and the scroll position, where they were.
 */

import { useMemo, useSyncExternalStore, type ReactNode } from 'react';

import { Button } from '@audiogubbins/design-system';
import type { AssetId, Region } from '@audiogubbins/domain';
import type { ProjectState } from '@audiogubbins/project-format';

import type { EditorAsset } from '../assets/editor-asset.js';
import { assetEntryId, regionEntryId } from '../assets/project-assets.js';
import type {
  AssetCatalogue,
  AssetCatalogueState,
  UnopenedEntry,
} from '../state/asset-catalogue.js';
import type { EditorViewStore } from '../state/editor-view-store.js';
import type { ProjectStores } from '../state/project-stores.js';
import { quoted } from '../wording.js';
import { CommandButton, type PanelCommands } from './command-button.js';

/** An asset or region of the project as the browser lists it. */
interface BrowserEntry {
  /** The identity a view names it by. */
  readonly id: string;
  /** What a view opens, or why it cannot open it yet. */
  readonly shown: EditorAsset | UnopenedEntry;
  /** The regions of an asset, in the project's order; none for a region. */
  readonly regions: readonly BrowserEntry[];
}

/**
 * The entries of `state` as `shown` holds them, an asset's regions under it.
 * One the catalogue has not caught up with yet is left out until it has.
 */
function browserEntries(state: ProjectState, shown: AssetCatalogueState): readonly BrowserEntry[] {
  const opened = new Map(shown.assets.map((asset) => [asset.id, asset] as const));
  const entryOf = (id: string): BrowserEntry['shown'] | undefined =>
    opened.get(id) ?? shown.unopened.get(id);
  const regionsOf = new Map<AssetId, Region[]>();
  for (const region of state.project.regions.values()) {
    const list = regionsOf.get(region.assetId);
    if (list === undefined) regionsOf.set(region.assetId, [region]);
    else list.push(region);
  }
  const entries: BrowserEntry[] = [];
  for (const asset of state.project.assets.values()) {
    const id = assetEntryId(asset.id);
    const entry = entryOf(id);
    if (entry === undefined) continue;
    const regions: BrowserEntry[] = [];
    for (const region of regionsOf.get(asset.id) ?? []) {
      const regionId = regionEntryId(region.id);
      const regionShown = entryOf(regionId);
      if (regionShown !== undefined)
        regions.push({ id: regionId, shown: regionShown, regions: [] });
    }
    entries.push({ id, shown: entry, regions });
  }
  return entries;
}

/** One asset or region: a press opens it, or a sentence says why it cannot open yet. */
function EntryItem({
  entry,
  inUse,
  commands,
}: {
  readonly entry: BrowserEntry;
  /** The identity the editor in use shows, where it shows one. */
  readonly inUse: string | undefined;
  readonly commands: PanelCommands;
}): ReactNode {
  const { shown } = entry;
  return (
    <li className="ag-editor-asset">
      {'reason' in shown ? (
        <>
          <p className="ag-editor-asset-name">{shown.name}</p>
          <p
            className="ag-panel-note"
            {...(shown.kind === 'unavailable' ? { 'data-ag-status': 'unavailable' } : {})}
          >
            {shown.reason}
          </p>
        </>
      ) : (
        <>
          <Button
            aria-current={inUse === entry.id ? 'true' : undefined}
            onClick={() => {
              commands.run('editor.open-asset', { asset: entry.id });
            }}
          >
            {shown.name}
          </Button>
          <p className="ag-panel-note">{shown.description}</p>
        </>
      )}
      {entry.regions.length > 0 && (
        <ul className="ag-editor-assets ag-asset-regions" aria-label={`Regions of ${shown.name}`}>
          {entry.regions.map((region) => (
            <EntryItem key={region.id} entry={region} inUse={inUse} commands={commands} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** The import control, or the file being imported and the control that calls it off. */
function ImportControls({
  projects,
  commands,
  labelFor,
}: {
  readonly projects: ProjectStores;
  readonly commands: PanelCommands;
  readonly labelFor: (id: string) => string;
}): ReactNode {
  const importing = useSyncExternalStore(projects.imports.subscribe, projects.imports.get);
  return (
    <div className="ag-asset-import">
      {importing.kind === 'importing' ? (
        <>
          <p role="status">{`Importing ${quoted(importing.fileName)}…`}</p>
          <CommandButton
            id="file.cancel-import"
            label={labelFor('file.cancel-import')}
            commands={commands}
            compact
          />
        </>
      ) : (
        <CommandButton
          id="file.import-audio"
          label={labelFor('file.import-audio')}
          commands={commands}
          compact
        />
      )}
    </div>
  );
}

/** What the browser says, or lists, of the project open or not. */
function ProjectAudio({
  projects,
  catalogue,
  editorViews,
  commands,
}: {
  readonly projects: ProjectStores;
  readonly catalogue: AssetCatalogue;
  readonly editorViews: EditorViewStore;
  readonly commands: PanelCommands;
}): ReactNode {
  const open = useSyncExternalStore(projects.project.subscribe, projects.project.get);
  const shown = useSyncExternalStore(catalogue.subscribe, catalogue.get);
  const inUse = useSyncExternalStore(editorViews.subscribe, () => {
    const panel = editorViews.get().focused;
    return panel === undefined ? undefined : editorViews.entry(panel)?.asset;
  });
  const entries = useMemo(
    () => (open.kind === 'open' ? browserEntries(open.snapshot.model.state, shown) : []),
    [open, shown],
  );
  if (open.kind === 'none') return <p>Open or create a project to keep audio in it.</p>;
  if (open.kind === 'opening') return <p>The project is opening.</p>;
  if (entries.length === 0) {
    return <p>This project has no audio yet. Import a WAV or AIFF file to add some.</p>;
  }
  return (
    <ul className="ag-editor-assets" aria-label="The project’s audio">
      {entries.map((entry) => (
        <EntryItem key={entry.id} entry={entry} inUse={inUse} commands={commands} />
      ))}
    </ul>
  );
}

/** The Asset Browser panel, or why it cannot list anything where this browser keeps no projects. */
export function AssetBrowserPanel({
  title,
  projects,
  projectsUnavailable,
  catalogue,
  editorViews,
  commands,
  labelFor,
}: {
  readonly title: string;
  readonly projects: ProjectStores | undefined;
  readonly projectsUnavailable: string | undefined;
  readonly catalogue: AssetCatalogue;
  readonly editorViews: EditorViewStore;
  readonly commands: PanelCommands;
  readonly labelFor: (id: string) => string;
}): ReactNode {
  return (
    <section className="ag-panel ag-asset-browser">
      <h2 className="ag-panel-title">{title}</h2>
      {projects === undefined ? (
        <p>{projectsUnavailable ?? 'This browser cannot keep projects.'}</p>
      ) : (
        <>
          <ImportControls projects={projects} commands={commands} labelFor={labelFor} />
          <ProjectAudio
            projects={projects}
            catalogue={catalogue}
            editorViews={editorViews}
            commands={commands}
          />
        </>
      )}
    </section>
  );
}
