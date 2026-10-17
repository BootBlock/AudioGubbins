/**
 * The Spectral panel's spectral edits (ADR-0082): those of the sound shown,
 * its region's own and then its asset's, each worded as the Inspector words
 * it with a glyph of what it did; hearing the original beside them; and
 * comparing the latest, or any one, with before it, by its command.
 */

import { useMemo, useSyncExternalStore, type ReactNode } from 'react';

import { Icon, type IconName, IconButton, Section } from '@audiogubbins/design-system';
import type { EditOperationId, SpectralEdit } from '@audiogubbins/domain';

import type { ModelGate } from '../../assets/model-gate.js';

import { commandPress } from '../command-press.js';
import { editWording, operationWords, regionOperationWords } from '../inspector/edit-words.js';
import { HearingSwitch } from '../rack/hearing-switch.js';
import type { ShownView, SpectralContext } from './shown-spectral.js';

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

/** The edits listed, in words, following the project, the view and the model gate. */
function useListedEdits(shown: ShownView, context: SpectralContext): readonly ListedEdit[] {
  const gate = useSyncExternalStore(context.modelGate.subscribe, context.modelGate.get);
  const project = shown.project;
  return useMemo(
    () => (project === undefined ? [] : listedEdits(shown, project, gate)),
    [shown, project, gate],
  );
}

/** A comparison of an edit with before it; of the latest where no edit is named. */
function CompareButton({
  label,
  args,
  context,
}: {
  readonly label: string;
  readonly args: Readonly<Record<string, string>>;
  readonly context: SpectralContext;
}): ReactNode {
  const { onPress, ...reason } = commandPress(context, 'spectral.compare-before-edit', args, {
    sayWhenUnchanged: true,
  });
  return (
    <IconButton icon="compare" label={label} hint={label} compact {...reason} onClick={onPress} />
  );
}

/**
 * The spectral edits of what the view shows: its region's own, then its
 * asset's, in the order made; hearing the original beside them; and comparing
 * the latest, or any one, with before it.
 *
 * The list keeps a heading of its own, hidden from sight, because the section's
 * header is the button that opens it rather than a heading a reader can move
 * to.
 */
export function SpectralEdits({
  shown,
  context,
}: {
  readonly shown: ShownView;
  readonly context: SpectralContext;
}): ReactNode {
  const listed = useListedEdits(shown, context);
  return (
    <Section
      title="Spectral edits"
      {...(listed.length === 0 ? {} : { summary: String(listed.length) })}
      actions={
        <CompareButton
          label="Compare with before the latest spectral edit"
          args={{ view: shown.panel }}
          context={context}
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
            {listed.map((edit) => (
              <li key={edit.id} className="ag-spectral-edit">
                <span className="ag-spectral-edit-words">{edit.words}</span>
                <Icon name={editIcon(edit.operation)} className="ag-spectral-edit-glyph" />
                <CompareButton
                  label="Compare with before it"
                  args={{ view: shown.panel, operationId: edit.id }}
                  context={context}
                />
              </li>
            ))}
          </ol>
        )}
      </div>
    </Section>
  );
}
