/**
 * The Export dialog's presets (ADR-0092, REQ-AUDIO-050): AudioGubbins's and
 * the person's own as radios, each saying what it sets, and the person's
 * edited settings where they edited any, so a preset never loses their work.
 * A preset that cannot be exported here as it is, such as a bit rate this
 * browser's encoder does not code, says why beside it: it is offered as it
 * is, never changed to something that can.
 */

import type { ReactNode } from 'react';

import { RadioGroup } from '@audiogubbins/design-system';

import {
  BUILT_IN_PRESETS,
  validateExportSettings,
  type ExportContext,
  type ExportSettings,
} from '@audiogubbins/import-export';

import { presetSettingsOver, type OfferedPreset } from '../../state/export-draft.js';
import type { ExportDialogStore, OpenExportDialog } from '../../state/export-dialog-store.js';
import type { OwnExportPreset } from '../../state/stored-export-presets.js';
import { ownPresetSentence, presetSentence } from './export-words.js';

/** One preset the dialog lists, by the key its radio is told apart by. */
interface ListedPreset {
  readonly key: string;
  readonly name: string;
  readonly sentence: string;
  readonly choose: () => void;
}

/** What a preset sets, and why its settings cannot be exported here where they cannot. */
function sentenceOf(said: string, settings: ExportSettings, context: ExportContext): string {
  const checked = validateExportSettings(settings, context);
  return checked.ok
    ? said
    : `${said} As it is, it cannot be exported here: ${checked.failures[0].summary}`;
}

/** The presets listed: AudioGubbins's, the person's, and their edited settings where they edited any. */
function listedPresets(
  open: OpenExportDialog,
  own: readonly OwnExportPreset[],
  dialog: ExportDialogStore,
): readonly ListedPreset[] {
  const offered: readonly OfferedPreset[] = [
    ...BUILT_IN_PRESETS.map((preset) => ({ kind: 'built-in', preset }) as const),
    ...own.map((preset) => ({ kind: 'own', preset }) as const),
  ];
  return [
    ...offered.map((one) => {
      const settings = presetSettingsOver(one, open.context, open.settings.range);
      const said =
        one.kind === 'own'
          ? ownPresetSentence(one.preset.settings)
          : presetSentence(one.preset, settings);
      return {
        key: one.preset.id,
        name: one.preset.name,
        sentence: sentenceOf(said, settings, open.context),
        choose: () => {
          dialog.choosePreset(one);
        },
      };
    }),
    ...(open.edited === undefined
      ? []
      : [
          {
            key: 'edited',
            name: 'Your edited settings',
            sentence: 'The settings as you last set them in this dialog.',
            choose: dialog.chooseEdited,
          },
        ]),
  ];
}

/** The key of the listed preset the settings came from, where they came from one. */
function chosenKey(open: OpenExportDialog): string | undefined {
  switch (open.source.kind) {
    case 'preset':
      return open.source.id;
    case 'edited':
      return 'edited';
    default:
      return undefined;
  }
}

/** The presets, as radios, each saying what it sets. */
export function Presets({
  open,
  own,
  dialog,
}: {
  readonly open: OpenExportDialog;
  readonly own: readonly OwnExportPreset[];
  readonly dialog: ExportDialogStore;
}): ReactNode {
  const chosen = chosenKey(open);
  const listed = listedPresets(open, own, dialog);
  const from =
    open.source.kind === 'kept'
      ? 'The settings start as this project was last exported with.'
      : open.source.kind === 'default'
        ? 'The settings start at the highest quality for this asset.'
        : undefined;
  return (
    <div className="ag-export-presets">
      <RadioGroup
        label="Preset"
        // None is chosen while the settings start from the project's last
        // export or the highest quality, which no preset is.
        value={chosen ?? ''}
        options={listed.map((preset) => ({
          value: preset.key,
          label: preset.name,
          description: preset.sentence,
        }))}
        onValueChange={(key) => {
          listed.find((preset) => preset.key === key)?.choose();
        }}
      />
      {from !== undefined && <p className="ag-dialogue-note">{from}</p>}
    </div>
  );
}
