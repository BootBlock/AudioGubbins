/**
 * How the Export dialog's settings are made (ADR-0092, REQ-AUDIO-050): from a
 * preset, from the format the person picks, and over the range the dialog
 * shows. Every path gives the one typed record the expert controls edit and
 * the export is made from, through the import-export package's own
 * resolution, so a preset and the same values set by hand are the same
 * record, and nothing here holds a rule of the settings: whether the record
 * can be made is the package's validation and planning to say.
 */

import {
  defaultExportSettings,
  resolvePreset,
  type ExportContext,
  type ExportFormat,
  type ExportPreset,
  type ExportRange,
  type ExportSettings,
} from '@audiogubbins/import-export';

import { settingsOver, type OwnExportPreset } from './stored-export-presets.js';

/**
 * The file name each range is named by until the person names it: the
 * project for one file of the whole or the selection, and the project and
 * the region for a region's, so files of every region are told apart.
 */
const NAME_FOR_RANGE: Readonly<Record<ExportRange['kind'], string>> = {
  project: '{project}',
  selection: '{project}',
  region: '{project} {region}',
  'every-region': '{project} {region}',
};

/** The format the dialog opens with where the project kept no settings: WAV, at its highest quality. */
const FIRST_FORMAT: ExportFormat = 'wav';

/**
 * `settings` over `range`. A file name that is the one the former range was
 * named by becomes the one the new range is; a name the person chose is
 * theirs, and kept as it is.
 */
export function overRange(settings: ExportSettings, range: ExportRange): ExportSettings {
  const named = settings.fileName === NAME_FOR_RANGE[settings.range.kind];
  return {
    ...settings,
    range,
    fileName: named ? NAME_FOR_RANGE[range.kind] : settings.fileName,
  };
}

/**
 * The settings a dialog over `range` opens with: those the project kept from
 * its last export, or the highest-quality ones of the first format.
 */
export function openingSettings(
  kept: ExportSettings | undefined,
  context: ExportContext,
  range: ExportRange,
): ExportSettings {
  return overRange(kept ?? defaultExportSettings(FIRST_FORMAT, context), range);
}

/** A preset the dialog offers: one AudioGubbins gives, or one of the person's own. */
export type OfferedPreset =
  | { readonly kind: 'built-in'; readonly preset: ExportPreset }
  | { readonly kind: 'own'; readonly preset: OwnExportPreset };

/**
 * The settings `offered` gives over `range`: a built-in preset resolved by the
 * package against the context, every value it leaves to the defaults filled
 * from them, and the file name the range is named by unless it names one; a
 * preset of the person's as they saved it.
 */
export function presetSettingsOver(
  offered: OfferedPreset,
  context: ExportContext,
  range: ExportRange,
): ExportSettings {
  if (offered.kind === 'own') return settingsOver(offered.preset.settings, range);
  const resolved = resolvePreset(offered.preset, context);
  return offered.preset.settings.fileName === undefined
    ? overRange(resolved, range)
    : { ...resolved, range };
}

/**
 * `settings` in `format`: the conversion, the metadata and the file name the
 * person set kept, and the format's encoding, rate and dither those the
 * package's defaults choose to suit them, as a preset choosing them would.
 */
export function inFormat(
  settings: ExportSettings,
  format: ExportFormat,
  context: ExportContext,
): ExportSettings {
  const { channels, metadata, fileName, range } = settings;
  const preset: ExportPreset = {
    id: format,
    name: format,
    format,
    settings: { channels, metadata, fileName },
  };
  return { ...resolvePreset(preset, context), range };
}
