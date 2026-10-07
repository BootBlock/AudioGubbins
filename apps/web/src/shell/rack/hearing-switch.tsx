/**
 * Hearing the original beside the processed sound (REQ-AUDIO-019): one
 * switch, pressed while the original is heard, which runs the command that
 * hears the other, and says which is heard. Shown by the Effects rack and the
 * Transport panel alike, so the two never disagree about what plays.
 */

import { useId, useSyncExternalStore, type ReactNode } from 'react';

import { Button } from '@audiogubbins/design-system';

import { Hearing } from '../../state/hearing-store.js';
import type { Observable } from '../../state/observable.js';
import type { PanelCommands } from '../command-button.js';

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
  const reason = commands.unavailableReason(id);
  const reasonId = useId();
  return (
    <div className="ag-inspector-row">
      <Button
        compact
        aria-pressed={original}
        aria-disabled={reason !== undefined}
        {...(reason === undefined ? {} : { 'aria-describedby': reasonId })}
        onClick={() => {
          if (reason === undefined) commands.run(id);
        }}
      >
        Hear the original
      </Button>
      <p className="ag-panel-note">
        {original ? 'The original is heard, every chain bypassed.' : 'It is heard processed.'}
      </p>
      {reason !== undefined && (
        <p id={reasonId} className="ag-panel-note">
          {reason}
        </p>
      )}
    </div>
  );
}
