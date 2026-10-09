/**
 * The Audio settings' input section (`ADR-0070`, `REQ-REC-090` to
 * `REQ-REC-092`, `REQ-REC-095`): the input, the capture profile with what it
 * asks the browser for and a Custom profile's form, the retrospective buffer,
 * the count-in, whether monitoring starts by itself, and the latency.
 *
 * The profile's detail is disclosed progressively: its name and a summary
 * first, each kind of processing and the Custom form on request. Every change
 * is a command. Showing the section watches the inputs, to list them, and
 * opens none.
 */

import { useState, useSyncExternalStore, type ReactNode } from 'react';

import { Button, OptionSelect, TextField, ToggleSwitch } from '@audiogubbins/design-system';
import {
  MAXIMUM_RETROSPECTIVE_SECONDS,
  MINIMUM_RETROSPECTIVE_SECONDS,
  PROCESSING_CONTROLS,
  processingOf,
} from '@audiogubbins/recording';

import { CHOOSE_INPUT } from '../../commands/recording-commands.js';
import {
  CHOOSE_PROFILE,
  MARK_HEADPHONES,
  MONITOR_AUTOMATICALLY,
  RETROSPECTIVE_OFF_COMMAND,
  SET_COUNT_IN,
  SET_RETROSPECTIVE,
} from '../../commands/recording-settings-commands.js';
import { identityOfDevice } from '../../recording/capture-facts.js';
import type { RecordingParts } from '../../recording/recording-part.js';
import { PROCESSING_NAMES, deviceName, permissionText } from '../../recording/recording-words.js';
import {
  LONGEST_COUNT_IN_SECONDS,
  chosenProfileOf,
  monitoringRemembered,
  type RecordingSettings,
} from '../../state/recording-settings.js';
import { useWatchedInputs } from '../recording/use-recording.js';
import { CaptureProfileForm } from './capture-profile-form.js';
import { LatencySettings } from './latency-settings.js';
import type { RunCommand } from './section.js';

/** What the input section needs. */
export interface RecordingInputProps {
  readonly settings: RecordingSettings;
  readonly recording: RecordingParts;
  readonly run: RunCommand;
  readonly unavailableReason: (id: string) => string | undefined;
}

/** A field's text as a command takes it: the number it reads as, or the text itself. */
function typed(text: string): number | string {
  const trimmed = text.trim();
  const value = Number(trimmed);
  return trimmed !== '' && Number.isFinite(value) ? value : text;
}

/** The input chooser, and whether the microphone is allowed. */
function InputChoice({ settings, recording, run }: RecordingInputProps): ReactNode {
  const view = useSyncExternalStore(recording.input.view.subscribe, recording.input.view.get);
  const listed = view.devices.flatMap((device) => identityOfDevice(device) ?? []);
  const chosen = view.opened?.device ?? settings.input;
  return (
    <>
      {listed.length > 0 ? (
        <OptionSelect
          label="Input"
          value={chosen?.id ?? ''}
          options={[
            ...(chosen === undefined ? [{ value: '', label: deviceName(undefined) }] : []),
            ...listed.map((device) => ({ value: device.id, label: deviceName(device) })),
          ]}
          onValueChange={(device) => {
            if (device !== '' && device !== chosen?.id) run(CHOOSE_INPUT, { device });
          }}
        />
      ) : (
        <p>{`Input: ${deviceName(chosen)}.`}</p>
      )}
      <p className="ag-settings-note">{permissionText(view.permission)}</p>
    </>
  );
}

/** The capture profile, its summary, what it asks for, and its headphones mark. */
function ProfileChoice({ settings, recording, run }: RecordingInputProps): ReactNode {
  const profile = chosenProfileOf(settings);
  const processing = processingOf(profile);
  const supported = recording.supported;
  return (
    <>
      <OptionSelect
        label="Capture profile"
        value={settings.chosenProfile}
        options={settings.profiles.map((one) => ({ value: one.name, label: one.name }))}
        onValueChange={(name) => {
          if (name !== settings.chosenProfile) run(CHOOSE_PROFILE, { profile: name });
        }}
      />
      <details>
        <summary>{`What ${profile.name} asks the browser for`}</summary>
        <ul>
          {PROCESSING_CONTROLS.map((control) => (
            <li key={control}>
              {`${PROCESSING_NAMES[control]}: ${processing[control] ? 'on' : 'off'}${
                supported?.[control] === true ? '' : ', which this browser offers no control of'
              }`}
            </li>
          ))}
        </ul>
      </details>
      <ToggleSwitch
        label={`${profile.name} is used with headphones`}
        description="Only a profile used with headphones may start monitoring by itself. No browser can tell headphones from speakers."
        checked={profile.headphones}
        onCheckedChange={(headphones) => {
          run(MARK_HEADPHONES, { profile: profile.name, headphones });
        }}
      />
      {/* Keyed by the profile, so choosing another starts the form from it. */}
      <CaptureProfileForm key={profile.name} chosen={profile} supported={supported} run={run} />
    </>
  );
}

/** The retrospective buffer and the count-in. */
function Timing({ settings, run }: RecordingInputProps): ReactNode {
  const { retrospective } = settings;
  const [seconds, setSeconds] = useState(retrospective.on ? String(retrospective.seconds) : '10');
  const [countIn, setCountIn] = useState(String(settings.countInSeconds));
  const keep = (): void => {
    run(SET_RETROSPECTIVE, { seconds: typed(seconds) });
  };
  const applyCountIn = (): void => {
    run(SET_COUNT_IN, { seconds: typed(countIn) });
  };
  return (
    <>
      <ToggleSwitch
        label="Keep the seconds before Record"
        description="While an input is armed, its last seconds are kept in memory, and written nowhere, so a take can begin before you pressed Record. They are overwritten when you disarm."
        checked={retrospective.on}
        onCheckedChange={(on) => {
          if (on) keep();
          else run(RETROSPECTIVE_OFF_COMMAND);
        }}
      />
      <TextField
        label={`Seconds kept, from ${String(MINIMUM_RETROSPECTIVE_SECONDS)} to ${String(MAXIMUM_RETROSPECTIVE_SECONDS)}`}
        value={seconds}
        onValueChange={setSeconds}
        onSubmit={keep}
      />
      <TextField
        label={`Count-in, in seconds, up to ${String(LONGEST_COUNT_IN_SECONDS)}`}
        value={countIn}
        onValueChange={setCountIn}
        onSubmit={applyCountIn}
      />
      <div className="ag-settings-row">
        <Button onClick={keep}>Keep these seconds</Button>
        <Button onClick={applyCountIn}>Apply the count-in</Button>
      </div>
    </>
  );
}

/** Whether monitoring starts by itself with the input and profile in use. */
function MonitoringPreference({ settings, recording, run }: RecordingInputProps): ReactNode {
  const view = useSyncExternalStore(recording.input.view.subscribe, recording.input.view.get);
  const profile = chosenProfileOf(settings);
  const device = view.opened?.device ?? settings.input;
  const remembered = device !== undefined && monitoringRemembered(settings, device, profile.name);
  return (
    <ToggleSwitch
      label="Start monitoring by itself with this input and profile"
      description={
        profile.headphones
          ? 'Monitoring starts when the input is armed. Turning monitoring on or off with this input and profile sets this too.'
          : 'Only a profile used with headphones starts monitoring by itself; mark the profile first.'
      }
      checked={remembered}
      disabled={device === undefined || !profile.headphones}
      onCheckedChange={(on) => {
        run(MONITOR_AUTOMATICALLY, { on });
      }}
    />
  );
}

/** The Audio settings' input section. */
export function RecordingInput(props: RecordingInputProps): ReactNode {
  useWatchedInputs(props.recording);
  return (
    <>
      <fieldset className="ag-settings-group">
        <legend>Recording input</legend>
        <InputChoice {...props} />
        <ProfileChoice {...props} />
        <Timing {...props} />
        <MonitoringPreference {...props} />
      </fieldset>
      <LatencySettings
        settings={props.settings}
        run={props.run}
        unavailableReason={props.unavailableReason}
      />
    </>
  );
}
