/**
 * A game export profile (ADR-0102): the format a group's members export to
 * and the choices of a preset for it, without the range and the file name,
 * which each member and its naming give.
 *
 * It is not a second settings model: it resolves to Phase 09's
 * `ExportSettings` as a preset does (`member-export-settings.ts`), so what a
 * profile does not choose takes the format's defaults for each member's own
 * audio.
 */

import type { ExportFormat, ExportPreset, PresetChoices } from '@audiogubbins/import-export';

/** What a profile chooses of one format's settings. */
type ProfileChoices<F extends ExportFormat> = Omit<PresetChoices<F>, 'range' | 'fileName'>;

/*
 * Each format's choices, as a profile's and as a preset's. Indexed by one
 * format, the first relates to the second, which keeps a format and its
 * choices together through the conversions below without a cast.
 */
type ProfileChoicesByFormat = { readonly [F in ExportFormat]: ProfileChoices<F> };
type PresetChoicesByFormat = { readonly [F in ExportFormat]: PresetChoices<F> };

type ProfileOf<K extends ExportFormat> = {
  readonly [F in K]: { readonly format: F; readonly choices: ProfileChoicesByFormat[F] };
}[K];

type PresetOf<K extends ExportFormat> = {
  readonly [F in K]: {
    readonly id: string;
    readonly name: string;
    readonly format: F;
    readonly settings: PresetChoicesByFormat[F];
  };
}[K];

export type GameExportProfile = ProfileOf<ExportFormat>;

function profileOf<F extends ExportFormat>(
  format: F,
  settings: PresetChoicesByFormat[F],
): ProfileOf<F> {
  const { range: _range, fileName: _fileName, ...choices } = settings;
  return { format, choices };
}

/**
 * A preset's choices as a profile: what applying a preset to a group stores.
 * The choices are copied, so the profile reads the same when presets change.
 */
export function profileFromPreset(preset: ExportPreset): GameExportProfile {
  return profileOf(preset.format, preset.settings);
}

/** The id of the preset a profile is resolved as; it is never listed or kept. */
const PROFILE_PRESET_ID = 'game-profile';

function presetOf<F extends ExportFormat>(
  format: F,
  choices: ProfileChoicesByFormat[F],
): PresetOf<F> {
  const settings: PresetChoicesByFormat[F] = choices;
  return { id: PROFILE_PRESET_ID, name: '', format, settings };
}

/** A profile as the preset `resolvePreset` takes, to resolve it for one member. */
export function profilePreset(profile: GameExportProfile): ExportPreset {
  return presetOf(profile.format, profile.choices);
}
