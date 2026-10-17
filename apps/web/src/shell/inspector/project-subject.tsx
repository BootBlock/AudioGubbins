/**
 * The Inspector on an asset or region of the project (REQ-EDIT-008,
 * REQ-EDIT-072): the subject and what a command would act on, what processes
 * it, its level, time and rate controls, the region's properties, and the
 * asset's source and edits, each changed through the command of the same name.
 */

import { useMemo, useSyncExternalStore, type ReactNode } from 'react';

import type { ProjectState } from '@audiogubbins/project-format';

import type { EditorPanelParts } from '../../editor/panel-parts.js';
import type { ModelGate } from '../../assets/model-gate.js';
import type { Observable } from '../../state/observable.js';
import type { PanelCommands } from '../command-button.js';
import { scopeOf } from '../selection-scope.js';
import { AssetSourceFacts } from './asset-source.js';
import { editWording, operationWords, type EditWording } from './edit-words.js';
import type { Inspected } from './inspected.js';
import { InspectorPart, InspectorSubject, InspectorSubpart } from './inspector-part.js';
import { LevelControls } from './level-controls.js';
import { ProcessingSummary } from './processing-summary.js';
import { RegionProperties } from './region-properties.js';
import { TimeControls } from './time-controls.js';

/** A subject of the project, as the Inspector shows one. */
type ProjectInspected = Extract<Inspected, { readonly kind: 'project' }>;

/** What the Inspector reads to show a subject of the project. */
export interface ProjectSubjectParts {
  readonly selections: EditorPanelParts['stores']['selections'];
  readonly labelFor: (id: string) => string;
  /** Why a processor cannot run for want of its model, which a spectral clean-up's words say. */
  readonly modelGate: Observable<ModelGate>;
}

/** How the subject's edits are worded, following the model gate and the project's chains. */
function useEditWording(
  subject: ProjectInspected,
  state: ProjectState | undefined,
  modelGate: Observable<ModelGate>,
): EditWording {
  const { view, state: viewState } = subject;
  const gate = useSyncExternalStore(modelGate.subscribe, modelGate.get);
  const chains = state?.project.effectChains;
  return useMemo(
    () =>
      editWording(
        subject.asset,
        { sampleRate: view.sampleRate, format: viewState.timeFormat },
        chains,
        gate,
      ),
    [subject.asset, view.sampleRate, viewState.timeFormat, chains, gate],
  );
}

/** The asset of the project: its source, its audio shape, its file's metadata and its edits. */
function AssetProperties({
  subject,
  words,
}: {
  readonly subject: ProjectInspected;
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
export function ProjectSubject({
  subject,
  state,
  parts,
  commands,
}: {
  readonly subject: ProjectInspected;
  readonly state: ProjectState | undefined;
  readonly parts: ProjectSubjectParts;
  readonly commands: PanelCommands;
}): ReactNode {
  const { view, panel } = subject;
  const words = useEditWording(subject, state, parts.modelGate);
  const selection = parts.selections.of(view.id);
  const region = subject.region?.region;
  return (
    <>
      <InspectorSubject
        icon={region === undefined ? 'asset' : 'region'}
        title={region === undefined ? subject.asset.displayName : region.displayName}
        detail={region === undefined ? view.description : `Region of ${subject.asset.displayName}`}
        scope={`Acts on ${scopeOf(selection, view, subject.state).text}`}
      />
      {state !== undefined && (
        <ProcessingSummary
          subject={subject}
          processors={selection.objects?.kind === 'processors' ? selection.objects.ids : []}
          state={state}
          commands={commands}
        />
      )}
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
