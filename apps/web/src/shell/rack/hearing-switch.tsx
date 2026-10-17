/**
 * Hearing the original beside the processed sound (REQ-AUDIO-019): one switch,
 * on while the original is heard, which runs the command that hears the other,
 * unavailable with that command's own reason, named as that command is, and
 * saying behind its hint that every chain and spectral edit is bypassed while
 * it is on, as the approved Transport draws it. Shown by the Effects rack, the
 * Transport and the Spectral panel alike, so they never disagree about what
 * plays.
 */

import { useSyncExternalStore, type ReactNode } from 'react';

import { Hint, ToggleSwitch } from '@audiogubbins/design-system';

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
    <span className="ag-hearing-switch">
      <ToggleSwitch
        label="Hear the original"
        checked={original}
        small
        {...optionalReason(commands.unavailableReason(id))}
        onCheckedChange={() => {
          commands.run(id);
        }}
      />
      <Hint label="About hearing the original">
        While it is on, the original is heard, every chain and spectral edit bypassed.
      </Hint>
    </span>
  );
}
