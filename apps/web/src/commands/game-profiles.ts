/**
 * The export presets a game export profile is set from (ADR-0102): those
 * AudioGubbins gives and the person's own, each copied into the profile as
 * its choices, without the range and the file name, which a member and its
 * naming give. A profile is a copy, so it reads the same however the presets
 * change, and a project never reads the person's preferences to export.
 */

import type { CommandInvocation } from '@audiogubbins/commands';
import { profileFromPreset, type GameExportProfile } from '@audiogubbins/game-audio';
import {
  BUILT_IN_PRESETS,
  type ExportFormat,
  type PresetChoices,
} from '@audiogubbins/import-export';

import type { OwnExportPreset } from '../state/stored-export-presets.js';
import { textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** A preset a profile may be set from: its identity, its name, and the profile it gives. */
export interface ProfilePreset {
  readonly id: string;
  readonly name: string;
  readonly profile: GameExportProfile;
}

type PresetOf<K extends ExportFormat> = {
  readonly [F in K]: {
    readonly id: string;
    readonly name: string;
    readonly format: F;
    readonly settings: PresetChoices<F>;
  };
}[K];

/**
 * The preset of `format` choosing `settings`. A person's preset holds every
 * value of one format's settings but the range, so its settings are that
 * format's choices; the profile made of it keeps the values a profile holds
 * and drops the file name, which a member's naming gives.
 */
function presetOf<F extends ExportFormat>(
  id: string,
  name: string,
  format: F,
  settings: PresetChoices<F>,
): PresetOf<F> {
  return { id, name, format, settings };
}

/** A preset of the person's as the profile it gives. */
function ownPreset(own: OwnExportPreset): ProfilePreset {
  return {
    id: own.id,
    name: own.name,
    profile: profileFromPreset(presetOf(own.id, own.name, own.settings.format, own.settings)),
  };
}

/** Every preset a profile may be set from: AudioGubbins's, then `own`, the person's own. */
export function profilePresets(own: readonly OwnExportPreset[]): readonly ProfilePreset[] {
  return [
    ...BUILT_IN_PRESETS.map((preset) => ({
      id: preset.id,
      name: preset.name,
      profile: profileFromPreset(preset),
    })),
    ...own.map(ownPreset),
  ];
}

/** The preset the invocation names by `preset`, as the profile it gives; or why there is none. */
export function presetProfile(
  context: Pick<ShellContext, 'preferences'>,
  invocation: CommandInvocation,
): ProfilePreset | string {
  const id = textArgument(invocation, 'preset');
  if (id === undefined) return 'Choose an export preset.';
  return (
    profilePresets(context.preferences.get().exportPresets).find((one) => one.id === id) ??
    'There is no export preset of that name.'
  );
}
