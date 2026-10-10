/**
 * The person's own export presets, and how their preferences keep them
 * (ADR-0092).
 *
 * A preset of the person's sets every value of the settings it was saved
 * from but the range: a preset is chosen for whatever the Export dialog was
 * opened over, and a region of one project means nothing in another. It is
 * kept as the project format's own export settings writer writes settings,
 * and read back by its reader, so a kept preset is held to the rules the
 * settings a project keeps are held to.
 *
 * Each preset is read on its own, so one that a hand edit or another build
 * broke costs the person that preset and not the rest. Whether a preset can
 * be made here is not a property of the record: it is checked against this
 * browser's codecs when it is chosen.
 */

import type { ExportRange, ExportSettings } from '@audiogubbins/import-export';
import {
  isJsonArray,
  isJsonObject,
  readExportSettings,
  startReading,
  writeExportSettings,
  type JsonObject,
  type JsonValue,
} from '@audiogubbins/project-format';

/** Settings without their range, taken apart per format so each keeps its own encoding. */
type WithoutRange<S> = S extends unknown ? Omit<S, 'range'> : never;

/** Every value of an export's settings but the range. */
export type PresetSettings = WithoutRange<ExportSettings>;

/** A preset of the person's: its name, and the settings it sets. */
export interface OwnExportPreset {
  /** Made from the name, so the same name saved again replaces the preset of that name. */
  readonly id: string;
  readonly name: string;
  readonly settings: PresetSettings;
}

/** The most presets kept, so a damaged record cannot make the dialog list without end. */
export const MOST_EXPORT_PRESETS = 256;

/** The longest name a preset is kept under, in UTF-16 code units. */
const LONGEST_PRESET_NAME = 120;

/** What starts the identity of a preset of the person's, apart from every built-in one. */
const OWN_PREFIX = 'own:';

/**
 * The range a kept preset is read with, since the reader requires one and the
 * preset then sets it aside: any range would do, and the project's is one.
 */
const READ_RANGE: JsonObject = { kind: 'project' };

/** The identity a preset of the person's named `name` is kept under. */
export function ownPresetId(name: string): string {
  return `${OWN_PREFIX}${name}`;
}

/** The settings without their range. */
export function presetSettings(settings: ExportSettings): PresetSettings {
  const { range: _range, ...rest } = settings;
  return rest;
}

/** The settings a preset sets, over `range`. */
export function settingsOver(settings: PresetSettings, range: ExportRange): ExportSettings {
  return { ...settings, range };
}

/** A preset as the preferences keep it. */
export function writeOwnPreset(preset: OwnExportPreset): JsonObject {
  const { range: _range, ...written } = writeExportSettings(
    settingsOver(preset.settings, { kind: 'project' }),
  );
  return { id: preset.id, name: preset.name, settings: written };
}

/** Why `name` cannot name a preset, or `undefined` where it can. */
export function presetNameProblem(name: string): string | undefined {
  if (name.trim() === '') return 'Give the preset a name.';
  if (name !== name.trim()) return 'A preset name neither starts nor ends with a space.';
  return name.length > LONGEST_PRESET_NAME
    ? `A preset name is at most ${String(LONGEST_PRESET_NAME)} characters long.`
    : undefined;
}

/** One kept preset, or `undefined` where it is not one this build reads. */
function readOwnPreset(value: JsonValue): OwnExportPreset | undefined {
  if (!isJsonObject(value)) return undefined;
  const name = value['name'];
  const settings = value['settings'];
  if (typeof name !== 'string' || presetNameProblem(name) !== undefined) return undefined;
  if (settings === undefined || !isJsonObject(settings)) return undefined;
  const reading = startReading();
  const read = reading.outcome(
    readExportSettings(reading, { ...settings, range: READ_RANGE }, '', 'settings'),
  );
  return read.ok
    ? { id: ownPresetId(name), name, settings: presetSettings(read.value) }
    : undefined;
}

/** What reading the kept presets found: those read, and how many could not be. */
export interface ReadPresets {
  readonly presets: readonly OwnExportPreset[];
  readonly unread: number;
}

/**
 * The presets a preferences record keeps, in the order they were saved, each
 * name once and at most `MOST_EXPORT_PRESETS`; none where the record keeps none.
 */
export function readOwnPresets(value: JsonValue | undefined): ReadPresets {
  if (value === undefined) return { presets: [], unread: 0 };
  if (!isJsonArray(value)) return { presets: [], unread: 1 };
  const presets: OwnExportPreset[] = [];
  const seen = new Set<string>();
  let unread = Math.max(0, value.length - MOST_EXPORT_PRESETS);
  for (const entry of value.slice(0, MOST_EXPORT_PRESETS)) {
    const preset = readOwnPreset(entry);
    if (preset === undefined || seen.has(preset.id)) {
      unread += 1;
      continue;
    }
    seen.add(preset.id);
    presets.push(preset);
  }
  return { presets, unread };
}
