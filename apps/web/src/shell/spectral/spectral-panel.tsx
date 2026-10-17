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

import { useMemo, useSyncExternalStore, type ReactNode } from 'react';

import {
  Banner,
  EmptyState,
  Icon,
  type IconName,
  IconButton,
  Section,
} from '@audiogubbins/design-system';
import type { EditOperationId, SpectralEdit } from '@audiogubbins/domain';

import type { ModelGate } from '../../assets/model-gate.js';

import { commandPress } from '../command-press.js';
import { editWording, operationWords, regionOperationWords } from '../inspector/edit-words.js';
import { PressureControls } from '../pressure-controls.js';
import { HearingSwitch } from '../rack/hearing-switch.js';
import { OperationsSection } from './spectral-operations.js';
import { SelectionSection, ToolSection } from './spectral-selection-section.js';
import { SpectrogramSection } from './spectrogram-section.js';
import { useShownView, type ShownView, type SpectralContext } from './shown-spectral.js';

/** A spectral edit of the sound shown, in words, by its identifier, with what it did. */
interface ListedEdit {
  readonly id: EditOperationId;
  readonly words: string;
  readonly operation: SpectralEdit['operation'];
}

/** The glyph of what a spectral edit did: a removal is an attenuation to silence. */
function editIcon(operation: SpectralEdit['operation']): IconName {
  switch (operation.kind) {
    case 'attenuate':
      return operation.gain === 0 ? 'spectral-remove' : 'quieter';
    case 'isolate':
      return 'show-only';
    case 'heal':
      return 'spectral-heal';
    case 'process':
      return 'clean-up';
  }
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
    ...(region?.operations ?? []).flatMap((operation) =>
      operation.edit.kind === 'spectral'
        ? [
            {
              id: operation.id,
              words: regionOperationWords(operation, words),
              operation: operation.edit.operation,
            },
          ]
        : [],
    ),
    ...asset.edits.flatMap((operation, basis) =>
      operation.kind === 'process' && operation.edit.kind === 'spectral'
        ? [
            {
              id: operation.id,
              words: operationWords(operation, basis, words),
              operation: operation.edit.operation,
            },
          ]
        : [],
    ),
  ];
}

/**
 * The spectral edits of what the view shows: its region's own, then its
 * asset's, in the order made; hearing the original beside them; and comparing
 * the latest, or any one, with before it.
 *
 * The list keeps a heading of its own, hidden from sight, because the section's
 * header is the button that opens it rather than a heading a reader can move to.
 */
function SpectralEdits({
  shown,
  context,
}: {
  readonly shown: ShownView;
  readonly context: SpectralContext;
}): ReactNode {
  const gate = useSyncExternalStore(context.modelGate.subscribe, context.modelGate.get);
  const project = shown.project;
  const listed = useMemo(
    () => (project === undefined ? [] : listedEdits(shown, project, gate)),
    [shown, project, gate],
  );
  const { onPress: compareLatest, ...latestReason } = commandPress(
    context,
    'spectral.compare-before-edit',
    { view: shown.panel },
    { sayWhenUnchanged: true },
  );
  return (
    <Section
      title="Spectral edits"
      {...(listed.length === 0 ? {} : { summary: String(listed.length) })}
      actions={
        <IconButton
          icon="compare"
          label="Compare with before the latest spectral edit"
          hint="Compare with before the latest spectral edit"
          compact
          {...latestReason}
          onClick={compareLatest}
        />
      }
    >
      <HearingSwitch hearing={context.hearing} commands={context} />
      <div className="ag-spectral-edits">
        <h3 className="ag-visually-hidden">Spectral edits</h3>
        {listed.length === 0 ? (
          <p className="ag-spectral-caption">None yet.</p>
        ) : (
          <ol className="ag-spectral-edit-list">
            {listed.map((edit) => {
              const { onPress, ...reason } = commandPress(
                context,
                'spectral.compare-before-edit',
                { view: shown.panel, operationId: edit.id },
                { sayWhenUnchanged: true },
              );
              return (
                <li key={edit.id} className="ag-spectral-edit">
                  <span className="ag-spectral-edit-words">{edit.words}</span>
                  <Icon name={editIcon(edit.operation)} className="ag-spectral-edit-glyph" />
                  <IconButton
                    icon="compare"
                    label="Compare with before it"
                    hint="Compare with before it"
                    compact
                    {...reason}
                    onClick={onPress}
                  />
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </Section>
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
  return (
    <Section title="Brush strength">
      <PressureControls pressure={shown.pressure} run={context.run} />
    </Section>
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
        <EmptyState
          icon="spectral"
          title="No audio open"
          text="Open audio in an editor to select and repair an area of it here."
        />
      ) : (
        <div className="ag-spectral-body">
          <SelectionSection shown={shown} commands={context} />
          <ToolSection shown={shown} commands={context} />
          <PressureSection shown={shown} context={context} />
          <SpectrogramSection shown={shown} commands={context} />
          {shown.project === undefined ? (
            <Banner icon="information">
              It is not part of the project, so it keeps no spectral edits. Import a file to repair
              it.
            </Banner>
          ) : (
            <>
              <OperationsSection shown={shown} context={context} />
              <SpectralEdits shown={shown} context={context} />
            </>
          )}
        </div>
      )}
    </section>
  );
}
