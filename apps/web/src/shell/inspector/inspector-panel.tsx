/**
 * The Inspector panel (WU-05.D): the properties of what the editor last in use
 * acts on. That is what a command would act on in words, the asset's source
 * and audio shape with its edits, and the region's name, tags, loop and own
 * processing, each changed through the command of the same name, so the
 * Inspector, the palette and a shortcut make one change (REQ-EDIT-008).
 *
 * It reads the stores and runs commands; it writes nothing itself (`CLAUDE.md`
 * G2), and it follows every change to them, an undo included.
 */

import { useId, useSyncExternalStore, type ReactNode } from 'react';

import { formatPosition } from '@audiogubbins/timeline';

import { channelNames } from '../../assets/channel-names.js';
import type { EditorPanelParts } from '../../editor/panel-parts.js';
import type { AssetCatalogue } from '../../state/asset-catalogue.js';
import type { ProjectStores } from '../../state/project-stores.js';
import type { PanelCommands } from '../command-button.js';
import { scopeOf } from '../selection-scope.js';
import { operationWords, type EditWording } from './edit-words.js';
import { inspected, type Inspected } from './inspected.js';
import { LevelControls } from './level-controls.js';
import { RegionProperties } from './region-properties.js';
import { sourceFacts } from './source-words.js';

/** A store that never changes, standing in for the project where this browser keeps none. */
const NO_PROJECT = { get: () => undefined, subscribe: () => () => undefined };

/** What the Inspector reads: the editor's views, their selections and assets, and command labels. */
export interface InspectorParts {
  readonly editorViews: EditorPanelParts['stores']['editorViews'];
  readonly selections: EditorPanelParts['stores']['selections'];
  readonly assets: Pick<AssetCatalogue, 'get' | 'subscribe' | 'find'>;
  readonly labelFor: (id: string) => string;
}

/** Reads what the editor last in use acts on, following every store it is made from. */
function useInspected(parts: InspectorParts, projects: ProjectStores | undefined): Inspected {
  const { editorViews, selections } = parts;
  const views = useSyncExternalStore(editorViews.subscribe, editorViews.get);
  useSyncExternalStore(parts.assets.subscribe, parts.assets.get);
  useSyncExternalStore(selections.subscribe, selections.get);
  const open = useSyncExternalStore(
    projects?.project.subscribe ?? NO_PROJECT.subscribe,
    projects?.project.get ?? NO_PROJECT.get,
  );
  const panel = views.focused;
  const entry = panel === undefined ? undefined : editorViews.entry(panel);
  const asset = entry === undefined ? undefined : parts.assets.find(entry.asset);
  const view =
    panel === undefined || entry === undefined || asset === undefined
      ? undefined
      : { panel, asset, state: entry.state };
  return inspected(
    view,
    asset === undefined ? { recency: [] } : selections.of(asset.id),
    open?.kind === 'open' ? open.snapshot.model.state : undefined,
  );
}

/** The asset of the project: its source, its audio shape and its edits. */
function AssetProperties({
  subject,
  words,
}: {
  readonly subject: Extract<Inspected, { readonly kind: 'project' }>;
  readonly words: EditWording;
}): ReactNode {
  const heading = useId();
  const { asset } = subject;
  return (
    <section className="ag-inspector-section" aria-labelledby={heading}>
      <h3 className="ag-inspector-heading" id={heading}>
        {`Asset: ${asset.displayName}`}
      </h3>
      <dl className="ag-inspector-facts">
        {sourceFacts(subject.source, asset).map((fact) => (
          <div key={fact.term}>
            <dt>{fact.term}</dt>
            <dd>{fact.detail}</dd>
          </div>
        ))}
      </dl>
      <h4 className="ag-inspector-heading">Its edits</h4>
      {asset.edits.length === 0 ? (
        <p>None. It plays as its source does.</p>
      ) : (
        <ol className="ag-inspector-edits">
          {asset.edits.map((operation) => (
            <li key={operation.id}>{operationWords(operation, words)}</li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** What the Inspector shows of a subject of the project. */
function ProjectSubject({
  subject,
  parts,
  commands,
}: {
  readonly subject: Extract<Inspected, { readonly kind: 'project' }>;
  readonly parts: InspectorParts;
  readonly commands: PanelCommands;
}): ReactNode {
  const { view, state, panel } = subject;
  const words: EditWording = {
    position: (frames) => formatPosition(frames, view.sampleRate, state.timeFormat),
    channels: channelNames(subject.asset.channelLayout),
  };
  const scope = scopeOf(parts.selections.of(view.id), view, state);
  return (
    <>
      <p>{`Acts on ${scope.text}`}</p>
      <LevelControls panel={panel} commands={commands} labelFor={parts.labelFor} />
      {subject.region !== undefined && (
        <RegionProperties
          panel={panel}
          inspected={subject.region}
          commands={commands}
          labelFor={parts.labelFor}
          words={words}
        />
      )}
      <AssetProperties subject={subject} words={words} />
    </>
  );
}

/** The Inspector panel. */
export function InspectorPanel({
  title,
  projects,
  parts,
  commands,
}: {
  readonly title: string;
  readonly projects: ProjectStores | undefined;
  readonly parts: InspectorParts;
  readonly commands: PanelCommands;
}): ReactNode {
  const subject = useInspected(parts, projects);
  return (
    <section className="ag-panel ag-inspector">
      <h2 className="ag-panel-title">{title}</h2>
      {subject.kind === 'nothing' && <p>Open audio in an editor to see its properties here.</p>}
      {subject.kind === 'session' && (
        <>
          <p className="ag-editor-asset-name">{subject.view.name}</p>
          <p>{subject.view.description}</p>
          <p className="ag-panel-note">
            It is not part of the project, so it keeps no edits. Import a file to edit it.
          </p>
        </>
      )}
      {subject.kind === 'project' && (
        <ProjectSubject subject={subject} parts={parts} commands={commands} />
      )}
    </section>
  );
}
