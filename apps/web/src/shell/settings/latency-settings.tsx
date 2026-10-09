/**
 * The recording latency's settings (`REQ-REC-095`): each calibration kept, for
 * which input and rate, what it measured and when, and its manual offset; the
 * guided calibration of the input in use; a manual offset typed in
 * milliseconds; and forgetting the calibration of the path in use.
 */

import { useState, type ReactNode } from 'react';

import { Button, TextField } from '@audiogubbins/design-system';
import type { LatencyCalibration } from '@audiogubbins/recording';

import {
  FORGET_CALIBRATION,
  SET_MANUAL_OFFSET,
} from '../../commands/recording-settings-commands.js';
import { deviceName, millisecondsText } from '../../recording/recording-words.js';
import type { RecordingSettings } from '../../state/recording-settings.js';
import type { RunCommand } from './section.js';

/** When a calibration was measured, as a reader says it. */
const MEASURED_AT = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

/** Hertz, in a sentence. */
const HERTZ = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

/** One kept calibration, in words. */
function calibrationText(calibration: LatencyCalibration): string {
  const { rate, measured, manualOffset } = calibration;
  const path = `${deviceName(calibration.input)} at ${HERTZ.format(rate)} Hz`;
  const offset =
    manualOffset === 0 ? '' : `; manual offset ${millisecondsText(manualOffset / rate)}`;
  if (measured === undefined) return `${path}: not measured${offset}.`;
  return `${path}: round trip ${millisecondsText(measured.roundTrip / rate)}, of which the output ${millisecondsText(measured.output / rate)} and the input ${millisecondsText(measured.input / rate)}, measured ${MEASURED_AT.format(measured.at)}${offset}.`;
}

/** The latency calibration's settings. */
export function LatencySettings({
  settings,
  run,
  unavailableReason,
}: {
  readonly settings: RecordingSettings;
  readonly run: RunCommand;
  readonly unavailableReason: (id: string) => string | undefined;
}): ReactNode {
  const [offset, setOffset] = useState('');
  const applyOffset = (): void => {
    // Text that reads as no number is given as it is, so the command says why.
    const trimmed = offset.trim();
    const milliseconds = Number(trimmed);
    run(SET_MANUAL_OFFSET, {
      milliseconds: trimmed !== '' && Number.isFinite(milliseconds) ? milliseconds : offset,
    });
  };
  const calibrateProblem = unavailableReason('recording.calibrate');
  const forgetProblem = unavailableReason(FORGET_CALIBRATION);
  return (
    <fieldset className="ag-settings-group">
      <legend>Recording latency</legend>
      <p className="ag-settings-note">
        A take is placed earlier by the round trip from the output back to the input, so it lines up
        with what you heard while recording. The recorded samples are never moved.
      </p>
      {settings.calibrations.length === 0 ? (
        <p>No calibration is kept: takes are placed by the latencies the browser reports.</p>
      ) : (
        <ul aria-label="Calibrations kept">
          {settings.calibrations.map((calibration) => (
            <li key={`${calibration.input.id}:${String(calibration.rate)}`}>
              {calibrationText(calibration)}
            </li>
          ))}
        </ul>
      )}
      <p className="ag-settings-note">
        To calibrate, place the microphone near the speaker, or connect the output to the input with
        a cable, and keep the room quiet.
      </p>
      {calibrateProblem !== undefined && <p className="ag-settings-note">{calibrateProblem}</p>}
      <TextField
        label="Manual offset, in milliseconds"
        description="Added to the measured round trip, or used alone; later is positive."
        value={offset}
        onValueChange={setOffset}
        onSubmit={applyOffset}
      />
      <div className="ag-settings-row">
        <Button
          onClick={() => {
            run('recording.calibrate');
          }}
        >
          Calibrate
        </Button>
        <Button onClick={applyOffset}>Apply the offset</Button>
        <Button
          onClick={() => {
            run(FORGET_CALIBRATION);
          }}
        >
          Forget this calibration
        </Button>
      </div>
      {forgetProblem !== undefined && <p className="ag-settings-note">{forgetProblem}</p>}
    </fieldset>
  );
}
