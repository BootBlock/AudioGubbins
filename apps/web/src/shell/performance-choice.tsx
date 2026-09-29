/**
 * The choice of performance profile, each through its command: the three
 * presets and Custom, whose settings the Audio settings edit (REQ-ARCH-083).
 * Shared by the Transport panel and the settings, so the two cannot offer
 * different profiles.
 */

import type { ReactNode } from 'react';

import { OptionSelect } from '@audiogubbins/design-system';
import type { PerformanceProfile } from '@audiogubbins/audio-engine';

import { PROFILES, PROFILE_NAMES, profileCommandId } from '../commands/audio-commands.js';

/** The profile in force, chosen from the four. */
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
      options={PROFILES.map((one) => ({ value: one, label: PROFILE_NAMES[one] }))}
      onValueChange={(value) => {
        const chosen = PROFILES.find((one) => one === value);
        if (chosen !== undefined && chosen !== profile) run(profileCommandId(chosen));
      }}
    />
  );
}
