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
import { COMMAND_GLYPHS } from './command-glyphs.js';

/**
 * The profile in force, chosen from the four, each with the glyph of the
 * command that chooses it, as its menu entry and its palette row draw it.
 */
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
      options={PROFILES.map((one) => {
        const icon = COMMAND_GLYPHS.get(profileCommandId(one));
        return { value: one, label: PROFILE_NAMES[one], ...(icon === undefined ? {} : { icon }) };
      })}
      onValueChange={(value) => {
        const chosen = PROFILES.find((one) => one === value);
        if (chosen !== undefined && chosen !== profile) run(profileCommandId(chosen));
      }}
    />
  );
}
