/**
 * The Recording panel's latency (`REQ-REC-094`, `REQ-REC-095`): the output's
 * and the input's latency as the browser reports them, the round trip a
 * calibration measured and when, whether that calibration still applies, what
 * a take is placed by, and the guided calibration itself.
 *
 * Compensation is a take's placement, never a change to its samples, and the
 * panel says so beside the figure it applies.
 */

import { useSyncExternalStore, type ReactNode } from 'react';

import { sampleRate } from '@audiogubbins/domain';
import { calibrationOf, takeCompensation, type CalibrationPath } from '@audiogubbins/recording';

import { calibrating, type CalibrationStage } from '../../recording/calibration-control.js';
import { calibrationStanding } from '../../recording/input-diagnostics.js';
import type { InputView } from '../../recording/input-view.js';
import type { RecordingParts } from '../../recording/recording-part.js';
import { deviceName, millisecondsText } from '../../recording/recording-words.js';
import { SYSTEM_OUTPUT } from '../../recording/system-output.js';
import type { RecordingSettings } from '../../state/recording-settings.js';
import { CommandButton, useCommandReasons, type PanelCommands } from '../command-button.js';

/** When a calibration was measured, as a reader says it. */
const MEASURED_AT = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

const BASES = {
  measured: 'the round trip a calibration measured',
  reported: 'the latencies the browser reports for the output and the input',
  'output-only': "the output's latency alone, since the browser reports none for the input",
} as const;

/** The calibration's stage in words. */
function stageText(stage: CalibrationStage): string | undefined {
  switch (stage.kind) {
    case 'idle':
      return undefined;
    case 'opening':
      return 'Opening the input for the calibration.';
    case 'measuring':
      return `Playing the burst and listening on ${deviceName(stage.device)}.`;
    case 'analysing':
      return 'Measuring the round trip.';
    case 'measured':
      return 'The round trip was measured.';
    case 'refused':
      return `The latency was not measured. ${stage.reason}`;
  }
}

/** The calibration path in use, where the input and the rate are known. */
export function pathOf(view: InputView, settings: RecordingSettings): CalibrationPath | undefined {
  const input = view.opened?.device ?? settings.input;
  const rate = view.context === undefined ? undefined : sampleRate(view.context.sampleRate);
  return input === undefined || rate?.ok !== true
    ? undefined
    : { input, output: SYSTEM_OUTPUT, rate: rate.value };
}

/** The latency figures, as far as each is known. */
function Figures({
  view,
  settings,
  path,
}: {
  readonly view: InputView;
  readonly settings: RecordingSettings;
  readonly path: CalibrationPath | undefined;
}): ReactNode {
  const report = view.context;
  if (report === undefined || path === undefined) {
    return (
      <p className="ag-panel-note">
        The latencies are known once an input is chosen and the audio has started, by arming the
        input or playing something.
      </p>
    );
  }
  const output = report.baseLatencySeconds + (report.outputLatencySeconds ?? 0);
  const input = view.opened?.granted.latency;
  const calibration = calibrationOf(settings.calibrations, path);
  const compensation = takeCompensation(settings.calibrations, path, {
    output,
    ...(input === undefined ? {} : { input }),
  });
  return (
    <dl className="ag-readings">
      <div className="ag-reading">
        <dt>Output</dt>
        <dd>
          {report.outputLatencySeconds === undefined
            ? `at least ${millisecondsText(output)}; the browser does not report the device's share`
            : millisecondsText(output)}
        </dd>
      </div>
      <div className="ag-reading">
        <dt>Input</dt>
        <dd>{input === undefined ? 'not reported by this browser' : millisecondsText(input)}</dd>
      </div>
      <div className="ag-reading">
        <dt>Round trip</dt>
        <dd>
          {calibration?.measured === undefined
            ? 'not measured'
            : `${millisecondsText(calibration.measured.roundTrip / path.rate)}, measured ${MEASURED_AT.format(calibration.measured.at)}`}
        </dd>
      </div>
      <div className="ag-reading">
        <dt>Takes placed by</dt>
        <dd>
          {`${millisecondsText(compensation.frames / path.rate)} earlier, from ${BASES[compensation.basis]}${
            compensation.manualOffset === 0
              ? ''
              : `, with a manual offset of ${millisecondsText(compensation.manualOffset / path.rate)}`
          }. The recorded samples are never moved.`}
        </dd>
      </div>
    </dl>
  );
}

/** The latency part of the Recording panel. */
export function LatencySection({
  recording,
  view,
  settings,
  commands,
}: {
  readonly recording: RecordingParts;
  readonly view: InputView;
  readonly settings: RecordingSettings;
  readonly commands: PanelCommands;
}): ReactNode {
  const stage = useSyncExternalStore(
    recording.calibration.stage.subscribe,
    recording.calibration.stage.get,
  );
  const shared = useCommandReasons(commands, ['recording.calibrate']);
  const path = pathOf(view, settings);
  const standing = calibrationStanding(settings, path);
  const said = stageText(stage);
  return (
    <div>
      <h3>Latency</h3>
      <Figures view={view} settings={settings} path={path} />
      {standing.kind === 'stale' && (
        <p data-ag-status="reduced">
          {`The calibration was taken with another ${standing.changes.join(', ')}. Calibrate again for this path.`}
        </p>
      )}
      <p className="ag-panel-note">
        To calibrate, place the microphone near the speaker, or connect the output to the input with
        a cable, and keep the room quiet. A short burst of noise plays and is listened for.
      </p>
      {said !== undefined && <p>{said}</p>}
      <div className="ag-settings-row">
        {calibrating(stage) ? (
          <CommandButton id="recording.cancel-calibration" label="Cancel" commands={commands} />
        ) : (
          <CommandButton
            id="recording.calibrate"
            label="Calibrate"
            commands={commands}
            shared={shared}
          />
        )}
      </div>
    </div>
  );
}
