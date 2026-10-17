/**
 * The Inspector panel (WU-05.D): the properties of what the editor last in use
 * acts on. That is what a command would act on in words, the asset's source and
 * audio shape with its edits, its level, time and rate controls, and the
 * region's name, tags, loop and own processing, each changed through the
 * command of the same name, so the Inspector, the palette and a shortcut make
 * one change (REQ-EDIT-008). With processors selected it shows their settings,
 * by the controls the Effects rack shows them with; otherwise what the rack of
 * the asset or region runs, and the command that shows the rack (REQ-EDIT-072).
 *
 * For a region or an asset of the project it shows its game policy too: the
 * asset group it is in, and every field it resolves with where each value
 * comes from, overridden and reset there (`../game/member-policy.tsx`).
 *
 * Recording, an export the person asked to have described, and an asset
 * group chosen, are subjects of their own, shown in place of the editor's
 * (`own-subjects.tsx`).
 *
 * It reads the stores and runs commands; it writes nothing itself (`CLAUDE.md`
 * G2), and it follows every change to them, an undo included.
 */

import { useMemo, useSyncExternalStore, type ReactNode } from 'react';

import { ButtonTone, EmptyState, Hint } from '@audiogubbins/design-system';
import type { ProcessorId } from '@audiogubbins/domain';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import { targetChains } from '@audiogubbins/project-commands';
import type { ProjectState } from '@audiogubbins/project-format';

import type { EditorPanelParts } from '../../editor/panel-parts.js';
import type { AssetCatalogue } from '../../state/asset-catalogue.js';
import type { ProjectStores } from '../../state/project-stores.js';
import { processorIn } from '../../commands/library-access.js';
import { showPanelCommandId } from '../../commands/panel-commands.js';
import { targetName } from '../../commands/rack-target.js';
import { chainWords, processorLabel } from '../../commands/rack-words.js';
import { EditingPanelKinds } from '../../panel-kinds.js';
import { CommandButton, type PanelCommands } from '../command-button.js';
import { ProcessorControls } from '../rack/processor-controls.js';
import { scopeOf } from '../selection-scope.js';
import { editWording, operationWords, type EditWording } from './edit-words.js';
import type { ModelGate } from '../../assets/model-gate.js';
import type { Observable } from '../../state/observable.js';
import { inspected, type Inspected } from './inspected.js';
import { LevelControls } from './level-controls.js';
import { OwnSubjectView, useOwnSubject, type OwnSubjectParts } from './own-subjects.js';
import { RegionProperties } from './region-properties.js';
import { AssetSourceFacts } from './asset-source.js';
import { InspectorPart, InspectorSubject, InspectorSubpart } from './inspector-part.js';
import { TimeControls } from './time-controls.js';
import { MemberPolicy } from '../game/member-policy.js';

/** A store that never changes, standing in for the project where this browser keeps none. */
const NO_PROJECT = { get: () => undefined, subscribe: () => () => undefined };

/**
 * What the Inspector reads: the editor's views, their selections and assets,
 * command labels, and what its subjects of their own are read from
 * (`own-subjects.tsx`).
 */
export interface InspectorParts extends OwnSubjectParts {
  readonly editorViews: EditorPanelParts['stores']['editorViews'];
  readonly selections: EditorPanelParts['stores']['selections'];
  readonly assets: Pick<AssetCatalogue, 'get' | 'subscribe' | 'find'>;
  readonly labelFor: (id: string) => string;
  /** Why a processor cannot run for want of its model, which a spectral clean-up's words say. */
  readonly modelGate: Observable<ModelGate>;
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
    if (processor === undefined) {
      return (
        <InspectorPart
          key={id}
          heading="A processor no longer in the project"
          title="Processor"
          summary="No longer in the project"
        >
          {null}
        </InspectorPart>
      );
    }
    const label = processorLabel(processor.typeKey);
    const bypassed = !processor.enabled;
    return (
      <InspectorPart
        key={id}
        heading={`Processor: ${label}${bypassed ? ', bypassed' : ''}`}
        title={label}
        summary={bypassed ? 'Bypassed' : undefined}
      >
        {descriptor !== undefined && (
          <ProcessorControls
            processor={processor}
            descriptor={descriptor}
            panel={panel}
            commands={commands}
          />
        )}
      </InspectorPart>
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
  const asset = state.project.assets.get(subject.asset.id) ?? subject.asset;
  const target =
    subject.region === undefined
      ? ({ kind: 'asset', asset } as const)
      : ({ kind: 'region', region: subject.region.region, asset } as const);
  const { rack, ranges } = targetChains(target);
  const chain = rack === undefined ? undefined : state.project.effectChains.get(rack);
  const runs =
    chain === undefined
      ? 'It has no rack.'
      : `It runs ${chainWords(chain)}${chain.slots.some((slot) => !slot.enabled) ? ', some of it bypassed' : ''}.`;
  return (
    <InspectorPart
      heading={`Rack of ${targetName(target)}`}
      title="Rack"
      actions={
        <CommandButton
          id={showPanelCommandId(EditingPanelKinds.Rack)}
          label="Show the rack"
          commands={commands}
          tone={ButtonTone.Quiet}
          compact
        />
      }
    >
      <p className="ag-inspector-text">{`${runs}${rangesWords(ranges.length)}`}</p>
    </InspectorPart>
  );
}

/** The asset of the project: its source, its audio shape, its file's metadata and its edits. */
function AssetProperties({
  subject,
  words,
}: {
  readonly subject: Extract<Inspected, { readonly kind: 'project' }>;
  readonly words: EditWording;
}): ReactNode {
  const { asset } = subject;
  return (
    <InspectorPart
      heading={`Asset: ${asset.displayName}`}
      title="Asset"
      summary={asset.displayName}
    >
      <AssetSourceFacts source={subject.source} asset={asset} />
      <InspectorSubpart heading="Its edits" title="Edits" summary={String(asset.edits.length)}>
        {asset.edits.length === 0 ? (
          <p className="ag-inspector-detail">None. It plays as its source does.</p>
        ) : (
          <ol className="ag-inspector-steps">
            {asset.edits.map((operation, basis) => (
              <li key={operation.id}>{operationWords(operation, basis, words)}</li>
            ))}
          </ol>
        )}
      </InspectorSubpart>
    </InspectorPart>
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
  const gate = useSyncExternalStore(parts.modelGate.subscribe, parts.modelGate.get);
  const chains = state?.project.effectChains;
  const words = useMemo(
    () =>
      editWording(
        subject.asset,
        { sampleRate: view.sampleRate, format: viewState.timeFormat },
        chains,
        gate,
      ),
    [subject.asset, view.sampleRate, viewState.timeFormat, chains, gate],
  );
  const selection = parts.selections.of(view.id);
  const scope = scopeOf(selection, view, viewState);
  const processors = selection.objects?.kind === 'processors' ? selection.objects.ids : [];
  const region = subject.region?.region;
  return (
    <>
      <InspectorSubject
        icon={region === undefined ? 'asset' : 'region'}
        title={region === undefined ? subject.asset.displayName : region.displayName}
        detail={region === undefined ? view.description : `Region of ${subject.asset.displayName}`}
        scope={`Acts on ${scope.text}`}
      />
      {state !== undefined &&
        (processors.length > 0 ? (
          <SelectedProcessors ids={processors} state={state} panel={panel} commands={commands} />
        ) : (
          <RackSummary subject={subject} state={state} commands={commands} />
        ))}
      <LevelControls panel={panel} commands={commands} labelFor={parts.labelFor} />
      <TimeControls
        panel={panel}
        commands={commands}
        labelFor={parts.labelFor}
        sampleRate={view.sampleRate}
      />
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

/** What the Inspector shows of what the editor last in use acts on. */
function EditorSubject({
  subject,
  state,
  parts,
  commands,
}: {
  readonly subject: Inspected;
  readonly state: ProjectState | undefined;
  readonly parts: InspectorParts;
  readonly commands: PanelCommands;
}): ReactNode {
  switch (subject.kind) {
    case 'nothing':
      return (
        <EmptyState
          icon="inspector"
          title="No audio open"
          text="Open audio in an editor to see its properties here."
        />
      );
    case 'session':
      return (
        <InspectorSubject
          icon="audio-file"
          title={subject.view.name}
          detail={subject.view.description}
          hint={
            <Hint label="Why it keeps no edits">
              It is not part of the project, so it keeps no edits. Import a file to edit it.
            </Hint>
          }
        />
      );
    case 'project':
      return <ProjectSubject subject={subject} state={state} parts={parts} commands={commands} />;
  }
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
  const own = useOwnSubject(parts);
  return (
    <section className="ag-panel ag-inspector">
      <h2 className="ag-panel-title">{title}</h2>
      <div className="ag-inspector-body">
        {own === undefined ? (
          <>
            <EditorSubject subject={subject} state={state} parts={parts} commands={commands} />
            {subject.kind === 'project' && state !== undefined && (
              <MemberPolicy
                member={
                  subject.region === undefined
                    ? { kind: 'asset', asset: subject.asset.id }
                    : { kind: 'region', region: subject.region.region.id }
                }
                state={state}
                sources={{ projects, preferences: parts.preferences, commands }}
              />
            )}
          </>
        ) : (
          <OwnSubjectView own={own} parts={parts} projects={projects} commands={commands} />
        )}
      </div>
    </section>
  );
}
