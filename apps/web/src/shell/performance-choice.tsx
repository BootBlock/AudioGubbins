/**
 * The choice of performance profile, each through its command: the three
 * presets and Custom, whose settings the Audio settings edit (REQ-ARCH-083).
 * Shared by the Transport panel and the settings, so the two cannot offer
 * different profiles.
 */

import type { ReactNode } from 'react';

import { OptionSelect, type IconName } from '@audiogubbins/design-system';
import { PerformanceProfile } from '@audiogubbins/audio-engine';

import { PROFILES, PROFILE_NAMES, profileCommandId } from '../commands/audio-commands.js';

/** Each profile's glyph, by the icon vocabulary's own name for it. */
const PROFILE_GLYPHS: Readonly<Record<PerformanceProfile, IconName>> = {
  [PerformanceProfile.LowLatency]: 'low-latency',
  [PerformanceProfile.Balanced]: 'balanced',
  [PerformanceProfile.MaximumStability]: 'maximum-stability',
  [PerformanceProfile.Custom]: 'custom-profile',
};

/** The profile in force, chosen from the four, each with its glyph. */
export function PerformanceChoice({
  profile,
  run,
}: {
  readonly profile: PerformanceProfile;
  readonly run: (id: string) => void;
}): ReactNode {
  return (
    <OptionSelect
      label="Performance profile"
      value={profile}
      options={PROFILES.map((one) => ({
        value: one,
        label: PROFILE_NAMES[one],
        icon: PROFILE_GLYPHS[one],
      }))}
      onValueChange={(value) => {
        const chosen = PROFILES.find((one) => one === value);
        if (chosen !== undefined && chosen !== profile) run(profileCommandId(chosen));
      }}
    />
  );
}
