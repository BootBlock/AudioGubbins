/**
 * The input's state in the status bar (`REQ-REC-090`, `REQ-REC-091`): for as
 * long as an input is armed or open, which input, whether it is armed,
 * buffering and for how long, counting in, recording or calibrating, and
 * whether it is monitored, as distinct states; and nothing while no input is.
 *
 * While a take is recorded, how much of it storage has kept, and the storage
 * left where it runs low, are shown beside the state; the warning is said
 * once by the recording flow, and the seconds kept are never said.
 *
 * Each change of state is said once, politely, as it happens: the state and
 * monitoring, never the seconds of a buffer filling, which would make a live
 * region of a clock. This is the one place those changes are said, so a
 * command that arms, disarms or turns monitoring on or off leaves the saying
 * to it.
 */

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';

import type { DeviceIdentity } from '@audiogubbins/recording';

import type { CalibrationStage } from '../../recording/calibration-control.js';
import { inputStatus, type InputStatus as Status } from '../../recording/input-view.js';
import type { RecordingParts } from '../../recording/recording-part.js';
import { monitoringText, statusText } from '../../recording/recording-words.js';
import { recordedText, timeLeftWarning } from '../../recording/take-words.js';
import { useInputView } from './use-recording.js';

/** The device a calibration has open, where one is running. */
function calibrationInput(
  stage: CalibrationStage,
): { readonly device: DeviceIdentity | undefined } | undefined {
  switch (stage.kind) {
    case 'opening':
      return { device: undefined };
    case 'measuring':
    case 'analysing':
      return { device: stage.device };
    case 'idle':
    case 'measured':
    case 'refused':
      return undefined;
  }
}

/** What a status's state is, for saying it once per change: its kind, not its seconds. */
function stateOf(status: Status | undefined, monitored: boolean): string {
  return status === undefined ? 'closed' : `${status.kind}:${String(monitored)}`;
}

/**
 * How much of the take being recorded storage has kept, and the storage left
 * where it runs low; nothing while no take is recorded.
 */
function TakeProgressItems({ recording }: { readonly recording: RecordingParts }): ReactNode {
  const progress = useSyncExternalStore(
    recording.takes.progress.subscribe,
    recording.takes.progress.get,
  );
  if (progress.kind !== 'recording') return null;
  const warning = timeLeftWarning(progress.timeLeft);
  return (
    <>
      <span className="ag-status-item">
        {`${progress.take}: ${recordedText(progress.committed / progress.rate)} kept`}
      </span>
      {warning !== undefined && (
        <span className="ag-status-item" data-ag-status="unavailable">
          {warning}
        </span>
      )}
    </>
  );
}

/** The input's state, in the status bar. */
export function InputStatus({
  recording,
  announce,
}: {
  readonly recording: RecordingParts;
  readonly announce: (text: string) => void;
}): ReactNode {
  const view = useInputView(recording);
  const stage = useSyncExternalStore(
    recording.calibration.stage.subscribe,
    recording.calibration.stage.get,
  );
  const monitoring = useSyncExternalStore(
    recording.monitoring.view.subscribe,
    recording.monitoring.view.get,
  );
  const status = inputStatus(view, calibrationInput(stage));
  const monitored = monitoring.monitoring.kind === 'on';
  const state = stateOf(status, monitored);
  const said = useRef(state);

  useEffect(() => {
    if (said.current === state) return;
    said.current = state;
    announce(
      status === undefined
        ? 'The input is closed.'
        : `${statusText(status)}. ${monitoringText(monitoring)}`,
    );
  }, [state, status, monitoring, announce]);

  if (status === undefined) return null;
  return (
    <span className="ag-status-notice" role="group" aria-label="Input">
      <span
        className="ag-status-item"
        data-ag-status={status.kind === 'recording' ? 'unavailable' : 'reduced'}
      >
        {statusText(status)}
      </span>
      <TakeProgressItems recording={recording} />
      <span className="ag-status-item" data-ag-status={monitored ? 'reduced' : undefined}>
        {monitored ? 'Monitoring' : 'Not monitoring'}
      </span>
    </span>
  );
}
