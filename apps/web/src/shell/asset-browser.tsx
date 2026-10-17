/**
 * The Asset Browser panel: the open project's audio, each asset with its
 * regions under it in the project's order, any of them opened in the editor in
 * use with a press, and the controls that import files and list them as they
 * are imported (REQ-STOR-025, REQ-EDIT-014). An asset that is a take's
 * recording says so, naming its take and stack (ADR-0072).
 *
 * An entry the page cannot open yet says why, as the editor view of it would.
 * The list follows the project and the catalogue, whose entries keep their
 * identity while nothing they are made from changes, and each row is keyed by
 * what it shows, so a change redraws its own row and leaves the rest, with the
 * focus and the scroll position, where they were.
 */

import { useMemo, useSyncExternalStore, type ReactNode } from 'react';

import {
  Badge,
  BadgeTone,
  Button,
  ButtonTone,
  EmptyState,
  Icon,
  IconSize,
  PanelStateTone,
  Skeleton,
  Spinner,
} from '@audiogubbins/design-system';
import type { AssetId, Region } from '@audiogubbins/domain';
import type { ProjectState } from '@audiogubbins/project-format';

import type { EditorAsset } from '../assets/editor-asset.js';
import { assetEntryId, regionEntryId } from '../assets/project-entry.js';
import type {
  AssetCatalogue,
  AssetCatalogueState,
  UnopenedEntry,
} from '../state/asset-catalogue.js';
import type { EditorViewStore } from '../state/editor-view-store.js';
import type { ProjectStores } from '../state/project-stores.js';
import { ExportCommand } from '../commands/import-export-ids.js';
import { EXPORT_BUTTON } from '../import-export-words.js';
import { CommandButton, type PanelCommands } from './command-button.js';
import { ImportControl } from './import/import-control.js';
import { quoted } from '@audiogubbins/text';

/** An asset or region of the project as the browser lists it. */
interface BrowserEntry {
  /** The identity a view names it by. */
  readonly id: string;
  /** What a view opens, or why it cannot open it yet. */
  readonly shown: EditorAsset | UnopenedEntry;
  /** The regions of an asset, in the project's order; none for a region. */
  readonly regions: readonly BrowserEntry[];
  /** Which takes an asset is the recording of, where it is a take's (ADR-0072). */
  readonly takes?: string;
}

/** Which takes of `state` record `asset`, in a sentence, or nothing where none does. */
function takesOf(state: ProjectState, asset: AssetId): string | undefined {
  const named: string[] = [];
  for (const stack of state.project.takeStacks.values()) {
    for (const take of stack.takes) {
      if (take.asset === asset) named.push(`${quoted(take.name)} in ${quoted(stack.name)}`);
    }
  }
  return named.length === 0 ? undefined : `A recorded take: ${named.join(', ')}.`;
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
    const takes = takesOf(state, asset.id);
    entries.push({ id, shown: entry, regions, ...(takes === undefined ? {} : { takes }) });
  }
  return entries;
}

/** The glyph a row leads with: what it is, or that it is still being read. */
function EntryGlyph({ entry }: { readonly entry: BrowserEntry }): ReactNode {
  const { shown } = entry;
  if ('reason' in shown) {
    return shown.kind === 'finding' ? (
      <Spinner size={IconSize.Inline} />
    ) : (
      <Icon name="missing-file" />
    );
  }
  // No region carries a colour of its own yet, so a region is told by its glyph.
  return <Icon name={isRegion(shown) ? 'region' : 'audio-file'} />;
}

/** Whether `shown` is a region of the project rather than an asset. */
function isRegion(shown: EditorAsset): boolean {
  return shown.owner.kind === 'project' && shown.owner.region !== undefined;
}

/** One asset or region: a press opens it, or a sentence says why it cannot open yet. */
function EntryItem({
  entry,
  inUse,
  commands,
  nested = false,
}: {
  readonly entry: BrowserEntry;
  /** The identity the editor in use shows, where it shows one. */
  readonly inUse: string | undefined;
  readonly commands: PanelCommands;
  readonly nested?: boolean;
}): ReactNode {
  const { shown } = entry;
  const current = inUse === entry.id;
  return (
    <li className="ag-asset-entry">
      <div
        className="ag-asset-row ag-lit-row"
        data-ag-lit={current ? '' : undefined}
        data-ag-nested={nested ? '' : undefined}
      >
        <span className="ag-asset-glyph">
          <EntryGlyph entry={entry} />
        </span>
        {'reason' in shown ? (
          <>
            <p className="ag-asset-name">{shown.name}</p>
            <p
              className="ag-asset-detail"
              {...(shown.kind === 'unavailable' ? { 'data-ag-status': 'unavailable' } : {})}
            >
              {shown.reason}
            </p>
          </>
        ) : (
          <>
            {/* The row's whole face opens the entry: the button reaches over
                the row (asset-browser.css), and keeps the entry's name alone
                as its name. */}
            <Button
              tone={ButtonTone.Quiet}
              aria-current={current ? 'true' : undefined}
              onClick={() => {
                commands.run('editor.open-asset', { asset: entry.id });
              }}
            >
              {shown.name}
            </Button>
            <p className="ag-asset-detail">{shown.description}</p>
            {entry.takes !== undefined && <p className="ag-asset-detail">{entry.takes}</p>}
            <span className="ag-asset-actions">
              {entry.takes !== undefined && <Badge tone={BadgeTone.Accent}>Take</Badge>}
              {shown.owner.kind === 'project' && shown.owner.region !== undefined && (
                <CommandButton
                  id={ExportCommand.Region}
                  label={EXPORT_BUTTON}
                  args={{ region: shown.owner.region.id }}
                  commands={commands}
                  tone={ButtonTone.Quiet}
                  compact
                />
              )}
            </span>
          </>
        )}
      </div>
      {entry.regions.length > 0 && (
        <ul className="ag-asset-list ag-asset-sublist" aria-label={`Regions of ${shown.name}`}>
          {entry.regions.map((region) => (
            <EntryItem key={region.id} entry={region} inUse={inUse} commands={commands} nested />
          ))}
        </ul>
      )}
    </li>
  );
}

/** The project's audio as a list, its sounds counted over it. */
function AudioList({
  entries,
  inUse,
  commands,
}: {
  readonly entries: readonly BrowserEntry[];
  readonly inUse: string | undefined;
  readonly commands: PanelCommands;
}): ReactNode {
  return (
    <>
      <p className="ag-asset-list-head" aria-hidden="true">
        Sounds <span className="ag-asset-count">{entries.length}</span>
      </p>
      <ul className="ag-asset-list" aria-label="The project’s audio">
        {entries.map((entry) => (
          <EntryItem key={entry.id} entry={entry} inUse={inUse} commands={commands} />
        ))}
      </ul>
    </>
  );
}

/**
 * What the browser says, or lists, of the project open or not, under the import
 * controls, which stay one set of elements whatever it shows.
 */
function ProjectAudio({
  projects,
  catalogue,
  editorViews,
  commands,
  labelFor,
}: {
  readonly projects: ProjectStores;
  readonly catalogue: AssetCatalogue;
  readonly editorViews: EditorViewStore;
  readonly commands: PanelCommands;
  readonly labelFor: (id: string) => string;
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
  const empty = open.kind === 'open' && entries.length === 0;
  const state =
    open.kind === 'none' ? (
      <EmptyState
        icon="project"
        title="No project is open"
        text="Open or create a project to keep audio in it."
      />
    ) : open.kind === 'opening' ? (
      <Skeleton label="The project is opening." lines={[1, 0.7, 0.85, 0.5]} />
    ) : empty ? (
      <EmptyState icon="waveform" title="No audio yet" text="Import audio files to add some." />
    ) : undefined;
  return (
    <>
      <ImportControl
        projects={projects}
        commands={commands}
        labelFor={labelFor}
        state={state}
        calling={empty}
      />
      {entries.length > 0 && <AudioList entries={entries} inUse={inUse} commands={commands} />}
    </>
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
      <div className="ag-asset-body">
        {projects === undefined ? (
          <EmptyState
            tone={PanelStateTone.Warning}
            icon="stored-projects"
            title={projectsUnavailable ?? 'This browser cannot keep projects.'}
          />
        ) : (
          <ProjectAudio
            projects={projects}
            catalogue={catalogue}
            editorViews={editorViews}
            commands={commands}
            labelFor={labelFor}
          />
        )}
      </div>
    </section>
  );
}
