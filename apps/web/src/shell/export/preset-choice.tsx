/**
 * The Export dialog's presets (ADR-0092, REQ-AUDIO-050): AudioGubbins's and
 * the person's own as radios, each saying what it sets, and the person's
 * edited settings where they edited any, so a preset never loses their work.
 */

import { useId, type ReactNode } from 'react';

import { BUILT_IN_PRESETS } from '@audiogubbins/import-export';

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
    ...offered.map((one) => ({
      key: one.preset.id,
      name: one.preset.name,
      sentence:
        one.kind === 'own'
          ? ownPresetSentence(one.preset.settings)
          : presetSentence(one.preset, presetSettingsOver(one, open.context, open.settings.range)),
      choose: () => {
        dialog.choosePreset(one);
      },
    })),
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
  const name = useId();
  const chosen = chosenKey(open);
  const from =
    open.source.kind === 'kept'
      ? 'The settings start as this project was last exported with.'
      : open.source.kind === 'default'
        ? 'The settings start at the highest quality for this asset.'
        : undefined;
  return (
    <fieldset className="ag-settings-group">
      <legend>Preset</legend>
      {from !== undefined && <p className="ag-panel-note">{from}</p>}
      {listedPresets(open, own, dialog).map((preset) => {
        const said = `${name}-${preset.key}`;
        const named = `${said}-name`;
        return (
          <label key={preset.key} className="ag-export-preset">
            <input
              type="radio"
              name={name}
              checked={preset.key === chosen}
              aria-labelledby={named}
              aria-describedby={said}
              onChange={preset.choose}
            />
            <span className="ag-export-preset-name" id={named}>
              {preset.name}
            </span>
            <span className="ag-panel-note" id={said}>
              {preset.sentence}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
