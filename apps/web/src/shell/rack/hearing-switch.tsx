/**
 * Hearing the original beside the processed sound (REQ-AUDIO-019): one
 * switch, on while the original is heard, which runs the command that hears
 * the other, unavailable with that command's own reason, and says while it is
 * on that every chain and spectral edit is bypassed. Shown by the Effects
 * rack, the Transport and the Spectral panel alike, so they never disagree
 * about what plays.
 */

import { useSyncExternalStore, type ReactNode } from 'react';

import { ToggleSwitch } from '@audiogubbins/design-system';

import { Hearing } from '../../state/hearing-store.js';
import type { Observable } from '../../state/observable.js';
import type { PanelCommands } from '../command-button.js';
import { optionalReason } from '../optional-reason.js';

/** Hearing the original beside the processed sound, a switch whose state is what is heard. */
export function HearingSwitch({
  hearing: store,
  commands,
}: {
  readonly hearing: Observable<Hearing>;
  readonly commands: PanelCommands;
}): ReactNode {
  const hearing = useSyncExternalStore(store.subscribe, store.get);
  const original = hearing === Hearing.Original;
  const id = original ? 'transport.listen-processed' : 'transport.listen-original';
  return (
    <ToggleSwitch
      label="Hear the original"
      checked={original}
      small
      {...(original
        ? { description: 'The original is heard, every chain and spectral edit bypassed.' }
        : {})}
      {...optionalReason(commands.unavailableReason(id))}
      onCheckedChange={() => {
        commands.run(id);
      }}
    />
  );
}
