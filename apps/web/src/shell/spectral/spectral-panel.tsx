/**
 * The Spectral panel (ADR-0082, REQ-AUDIO-016): what the editor in use has
 * selected in time and frequency, in words; the spectral tools and the settings
 * they draw with; the pen's pressure and the fixed strength; how the
 * spectrogram is analysed and drawn; the operations that repair the area, with
 * what each is given; and the spectral edits of the sound shown, each worded as
 * the Inspector words it and compared with before it by its command.
 *
 * It reads the stores and runs commands; it writes nothing itself (`CLAUDE.md`
 * G2), and it follows every change to them, an undo included.
 */

import { useId, useMemo, useSyncExternalStore, type ReactNode } from 'react';

import type { EditOperationId } from '@audiogubbins/domain';

import type { ModelGate } from '../../assets/model-gate.js';

import { CommandButton } from '../command-button.js';
import { editWording, operationWords, regionOperationWords } from '../inspector/edit-words.js';
import { PressureControls } from '../pressure-controls.js';
import { OperationsSection } from './spectral-operations.js';
import { SelectionSection, ToolSection } from './spectral-selection-section.js';
import { SpectrogramSection } from './spectrogram-section.js';
import { useShownView, type ShownView, type SpectralContext } from './shown-spectral.js';

/** A spectral edit of the sound shown, in words, by its identifier. */
interface ListedEdit {
  readonly id: EditOperationId;
  readonly words: string;
}

/** The spectral edits of what `shown` shows, its region's own first, each in words. */
function listedEdits(
  shown: ShownView,
  project: NonNullable<ShownView['project']>,
  gate: ModelGate,
): readonly ListedEdit[] {
  const asset = project.state.project.assets.get(project.owner.asset.id) ?? project.owner.asset;
  const words = editWording(
    asset,
    { sampleRate: shown.view.sampleRate, format: shown.state.timeFormat },
    project.state.project.effectChains,
    gate,
  );
  const region =
    project.owner.region === undefined
      ? undefined
      : project.state.project.regions.get(project.owner.region.id);
  return [
    ...(region?.operations ?? [])
      .filter((operation) => operation.edit.kind === 'spectral')
      .map((operation) => ({ id: operation.id, words: regionOperationWords(operation, words) })),
    ...asset.edits.flatMap((operation, basis) =>
      operation.kind === 'process' && operation.edit.kind === 'spectral'
        ? [{ id: operation.id, words: operationWords(operation, basis, words) }]
        : [],
    ),
  ];
}

/** The spectral edits of what the view shows: its region's own, then its asset's, in the order made. */
function SpectralEdits({
  shown,
  context,
}: {
  readonly shown: ShownView;
  readonly context: SpectralContext;
}): ReactNode {
  const heading = useId();
  const gate = useSyncExternalStore(context.modelGate.subscribe, context.modelGate.get);
  const project = shown.project;
  const listed = useMemo(
    () => (project === undefined ? [] : listedEdits(shown, project, gate)),
    [shown, project, gate],
  );
  return (
    <section className="ag-inspector-section" aria-labelledby={heading}>
      <h3 className="ag-inspector-heading" id={heading}>
        Spectral edits
      </h3>
      {listed.length === 0 ? (
        <p>None yet.</p>
      ) : (
        <ol className="ag-inspector-edits">
          {listed.map((edit) => (
            <li key={edit.id}>
              <span>{edit.words}</span>{' '}
              <CommandButton
                id="spectral.compare-before-edit"
                label="Compare with before it"
                commands={context}
                args={{ view: shown.panel, operationId: edit.id }}
                compact
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** The pen's pressure and the fixed strength, which the brush acts with. */
function PressureSection({
  shown,
  context,
}: {
  readonly shown: ShownView;
  readonly context: SpectralContext;
}): ReactNode {
  const heading = useId();
  return (
    <section className="ag-inspector-section" aria-labelledby={heading}>
      <h3 className="ag-inspector-heading" id={heading}>
        Brush strength
      </h3>
      <PressureControls pressure={shown.pressure} run={context.run} />
    </section>
  );
}

/** The Spectral panel. */
export function SpectralPanel({
  title,
  context,
}: {
  readonly title: string;
  readonly context: SpectralContext;
}): ReactNode {
  const shown = useShownView(context);
  return (
    <section className="ag-panel ag-spectral">
      <h2 className="ag-panel-title">{title}</h2>
      {shown === undefined ? (
        <p>Open audio in an editor to select and repair an area of it here.</p>
      ) : (
        <>
          <SelectionSection shown={shown} commands={context} />
          <ToolSection shown={shown} commands={context} />
          <PressureSection shown={shown} context={context} />
          <SpectrogramSection shown={shown} commands={context} />
          {shown.project === undefined ? (
            <p className="ag-panel-note">
              It is not part of the project, so it keeps no spectral edits. Import a file to repair
              it.
            </p>
          ) : (
            <>
              <OperationsSection shown={shown} context={context} />
              <SpectralEdits shown={shown} context={context} />
            </>
          )}
        </>
      )}
    </section>
  );
}
