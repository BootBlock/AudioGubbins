/**
 * The Inspector panel (WU-05.D): the properties of what the editor last in use
 * acts on. That is what a command would act on in words, the asset's source
 * and audio shape with its edits, and the region's name, tags, loop and own
 * processing, each changed through the command of the same name, so the
 * Inspector, the palette and a shortcut make one change (REQ-EDIT-008). With
 * processors selected it shows their settings, by the controls the Effects
 * rack shows them with; otherwise what the rack of the asset or region runs,
 * and the command that shows the rack (REQ-EDIT-072).
 *
 * It reads the stores and runs commands; it writes nothing itself (`CLAUDE.md`
 * G2), and it follows every change to them, an undo included.
 */

import { useId, useMemo, useSyncExternalStore, type ReactNode } from 'react';

import { shapesOf, type EffectChainId, type ProcessorId } from '@audiogubbins/domain';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import type { ProjectState } from '@audiogubbins/project-format';
import { formatPosition } from '@audiogubbins/timeline';

import { channelNames } from '../../assets/channel-names.js';
import type { EditorPanelParts } from '../../editor/panel-parts.js';
import type { AssetCatalogue } from '../../state/asset-catalogue.js';
import type { ProjectStores } from '../../state/project-stores.js';
import { processorIn } from '../../commands/library-access.js';
import { showPanelCommandId } from '../../commands/panel-commands.js';
import { chainsOfTarget, targetName } from '../../commands/rack-target.js';
import { chainWords, processorLabel } from '../../commands/rack-words.js';
import { EditingPanelKinds } from '../../panel-kinds.js';
import { CommandButton, type PanelCommands } from '../command-button.js';
import { ProcessorControls } from '../rack/processor-controls.js';
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

/**
 * Reads what the editor last in use acts on, and the project as it stands,
 * following every store either is made from.
 */
function useInspected(
  parts: InspectorParts,
  projects: ProjectStores | undefined,
): { readonly subject: Inspected; readonly state: ProjectState | undefined } {
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
  const state = open?.kind === 'open' ? open.snapshot.model.state : undefined;
  return {
    subject: inspected(
      view,
      asset === undefined ? { recency: [] } : selections.of(asset.id),
      state,
    ),
    state,
  };
}

/** The settings of each processor selected, by the controls the Effects rack shows them with. */
function SelectedProcessors({
  ids,
  state,
  panel,
  commands,
}: {
  readonly ids: readonly ProcessorId[];
  readonly state: ProjectState;
  readonly panel: string;
  readonly commands: PanelCommands;
}): ReactNode {
  return ids.map((id) => {
    const processor = processorIn(state, id);
    const descriptor =
      processor === undefined ? undefined : PROCESSOR_CATALOGUE.get(processor.typeKey);
    const bypassed = processor?.enabled === false ? ', bypassed' : '';
    return (
      <section key={id} className="ag-inspector-section" aria-label="Processor">
        <h3 className="ag-inspector-heading">
          {processor === undefined
            ? 'A processor no longer in the project'
            : `Processor: ${processorLabel(processor.typeKey)}${bypassed}`}
        </h3>
        {processor !== undefined && descriptor !== undefined && (
          <ProcessorControls
            processor={processor}
            descriptor={descriptor}
            panel={panel}
            commands={commands}
          />
        )}
      </section>
    );
  });
}

/** What the ranges a chain processes come to, in a sentence, or nothing where there are none. */
function rangesWords(count: number): string {
  if (count === 0) return '';
  return count === 1
    ? ' One of its ranges is processed by a chain of its own.'
    : ` ${String(count)} of its ranges are processed by chains of their own.`;
}

/** What the rack of the asset or region shown runs, and the command that shows the rack. */
function RackSummary({
  subject,
  state,
  commands,
}: {
  readonly subject: Extract<Inspected, { readonly kind: 'project' }>;
  readonly state: ProjectState;
  readonly commands: PanelCommands;
}): ReactNode {
  const heading = useId();
  const asset = state.project.assets.get(subject.asset.id) ?? subject.asset;
  const target =
    subject.region === undefined
      ? ({ kind: 'asset', asset } as const)
      : ({ kind: 'region', region: subject.region.region, asset } as const);
  const { rack, ranges } = chainsOfTarget(target);
  const chain = rack === undefined ? undefined : state.project.effectChains.get(rack);
  const runs =
    chain === undefined
      ? 'It has no rack.'
      : `It runs ${chainWords(chain)}${chain.slots.some((slot) => !slot.enabled) ? ', some of it bypassed' : ''}.`;
  return (
    <section className="ag-inspector-section" aria-labelledby={heading}>
      <h3 className="ag-inspector-heading" id={heading}>
        {`Rack of ${targetName(target)}`}
      </h3>
      <p>{`${runs}${rangesWords(ranges.length)}`}</p>
      <CommandButton
        id={showPanelCommandId(EditingPanelKinds.Rack)}
        label="Show the rack"
        commands={commands}
        compact
      />
    </section>
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
          {asset.edits.map((operation, basis) => (
            <li key={operation.id}>{operationWords(operation, basis, words)}</li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** What the Inspector shows of a subject of the project. */
function ProjectSubject({
  subject,
  state,
  parts,
  commands,
}: {
  readonly subject: Extract<Inspected, { readonly kind: 'project' }>;
  readonly state: ProjectState | undefined;
  readonly parts: InspectorParts;
  readonly commands: PanelCommands;
}): ReactNode {
  const { view, state: viewState, panel } = subject;
  // The asset's own layout is its source's: each edit is worded by the layout
  // its place in the chain had, a conversion before it included.
  const names = useMemo(
    () => shapesOf(subject.asset).map((shape) => channelNames(shape.layout)),
    [subject.asset],
  );
  const chains = state?.project.effectChains;
  const words: EditWording = {
    position: (frames) => formatPosition(frames, view.sampleRate, viewState.timeFormat),
    channelsAt: (basis) => names[basis] ?? [],
    chain: (id: EffectChainId) => {
      const chain = chains?.get(id);
      return chain === undefined ? 'a chain the project does not hold' : chainWords(chain);
    },
  };
  const selection = parts.selections.of(view.id);
  const scope = scopeOf(selection, view, viewState);
  const processors = selection.objects?.kind === 'processors' ? selection.objects.ids : [];
  return (
    <>
      <p>{`Acts on ${scope.text}`}</p>
      {state !== undefined &&
        (processors.length > 0 ? (
          <SelectedProcessors ids={processors} state={state} panel={panel} commands={commands} />
        ) : (
          <RackSummary subject={subject} state={state} commands={commands} />
        ))}
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
  const { subject, state } = useInspected(parts, projects);
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
        <ProjectSubject subject={subject} state={state} parts={parts} commands={commands} />
      )}
    </section>
  );
}
