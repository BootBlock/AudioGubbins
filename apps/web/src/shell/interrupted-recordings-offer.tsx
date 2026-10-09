/**
 * The offer of each recording the open project holds cut short (`ADR-0071`,
 * `REQ-REC-096`), first in the project's banner, before anything recovery says
 * of the project itself: how long it is, the input it was recorded on, when it
 * started and why it ended, with Recover and Discard. Discarding asks first,
 * saying what goes, and goes only on Confirm.
 *
 * Each control runs a command, so the offer is the keyboard's and a screen
 * reader's as much as the pointer's.
 */

import { useSyncExternalStore, type ReactNode } from 'react';

import { Button } from '@audiogubbins/design-system';
import type { InterruptedRecording } from '@audiogubbins/storage';

import {
  CONFIRM_DISCARD_INTERRUPTED,
  DISCARD_INTERRUPTED,
  KEEP_INTERRUPTED,
  RECOVER_INTERRUPTED,
  interruptedName,
} from '../commands/interrupted-recording-commands.js';
import { endingText } from '../recording/take-words.js';
import type { InterruptedRecordings } from '../state/interrupted-recordings.js';
import type { RunCommand } from './settings/section.js';

/** What is said of one recording cut short. */
function interruptedText(recording: InterruptedRecording): string {
  const device = recording.device.label ?? 'an input the browser did not name';
  const ending = `It ended because ${endingText(recording.ending)}.`;
  const gaps =
    recording.gaps === undefined
      ? ''
      : ` ${String(recording.gaps.frames)} frames could not be kept and are silence.`;
  const name = interruptedName(recording);
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}, on ${device}. ${ending}${gaps}`;
}

/** One recording cut short, and what can be done with it. */
function Offer({
  recording,
  confirming,
  busy,
  run,
}: {
  readonly recording: InterruptedRecording;
  readonly confirming: boolean;
  readonly busy: boolean;
  readonly run: RunCommand;
}): ReactNode {
  const args = { session: recording.session };
  return (
    <li data-ag-interrupted={recording.session}>
      <p className="ag-project-banner-text" data-ag-status="reduced">
        {interruptedText(recording)}
      </p>
      {busy ? (
        <p className="ag-project-banner-text">Working on it…</p>
      ) : confirming ? (
        <div role="group" aria-label="Discard the recording for good?">
          <p className="ag-project-banner-text">Discard it for good? Nothing can bring it back.</p>
          <Button compact onClick={() => run(CONFIRM_DISCARD_INTERRUPTED)}>
            Discard for good
          </Button>
          <Button compact onClick={() => run(KEEP_INTERRUPTED)}>
            Keep it
          </Button>
        </div>
      ) : (
        <>
          <Button compact onClick={() => run(RECOVER_INTERRUPTED, args)}>
            Recover
          </Button>
          <Button compact onClick={() => run(DISCARD_INTERRUPTED, args)}>
            Discard…
          </Button>
        </>
      )}
    </li>
  );
}

/** Every recording the open project holds cut short, offered to be recovered or discarded. */
export function InterruptedRecordingsOffer({
  offers,
  run,
}: {
  readonly offers: InterruptedRecordings;
  readonly run: RunCommand;
}): ReactNode {
  const { recordings, confirming, busy } = useSyncExternalStore(offers.subscribe, offers.get);
  if (recordings.length === 0) return null;
  return (
    <div className="ag-project-banner-report" role="group" aria-label="Recordings cut short">
      <p className="ag-project-banner-text">
        {recordings.length === 1
          ? 'A recording was cut short before it was finished. Recover it to make it a take, or discard it.'
          : 'Recordings were cut short before they were finished. Recover each to make it a take, or discard it.'}
      </p>
      <ul>
        {recordings.map((recording) => (
          <Offer
            key={recording.session}
            recording={recording}
            confirming={confirming === recording.session}
            busy={busy.has(recording.session)}
            run={run}
          />
        ))}
      </ul>
    </div>
  );
}
