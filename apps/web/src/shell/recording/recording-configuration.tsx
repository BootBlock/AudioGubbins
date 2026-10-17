/**
 * The Inspector's recording configuration (`REQ-EDIT-072`): while recording
 * is the subject, how the input is set up: which input, the capture profile
 * and the processing it asks for, what the browser granted, the retrospective
 * buffer and the count-in, monitoring and where it starts by itself, and the
 * latency calibration of the path.
 *
 * It reads the settings and the input and changes nothing: each setting is
 * changed in the Audio settings' input section, by its command.
 */

import { useSyncExternalStore, type ReactNode } from 'react';

import { PropertyGrid } from '@audiogubbins/design-system';

import { CaptureProfileKind, PROCESSING_CONTROLS, processingOf } from '@audiogubbins/recording';

import { calibrationStanding } from '../../recording/input-diagnostics.js';
import type { RecordingParts } from '../../recording/recording-part.js';
import { PROCESSING_NAMES, deviceName, monitoringText } from '../../recording/recording-words.js';
import type { AudioSettings } from '../../state/audio-settings-store.js';
import type { Observable } from '../../state/observable.js';
import { chosenProfileOf, monitoringRemembered } from '../../state/recording-settings.js';
import { CommandButton, type PanelCommands } from '../command-button.js';
import { GrantDisclosure } from './input-section.js';
import { calibrationPathOf } from '../../recording/calibration-path.js';
import { useInputView } from './use-recording.js';

/** What a profile's kind is called. */
const KIND_NAMES: Readonly<Record<CaptureProfileKind, string>> = {
  [CaptureProfileKind.RawStudio]: 'built in, for fidelity',
  [CaptureProfileKind.Voice]: 'built in, for speech over a call',
  [CaptureProfileKind.Custom]: 'your own',
};

/** The recording configuration, for the Inspector. */
export function RecordingConfiguration({
  recording,
  audioSettings,
  commands,
}: {
  readonly recording: RecordingParts;
  readonly audioSettings: Observable<AudioSettings>;
  readonly commands: PanelCommands;
}): ReactNode {
  const view = useInputView(recording);
  const settings = useSyncExternalStore(audioSettings.subscribe, audioSettings.get).recording;
  const monitoring = useSyncExternalStore(
    recording.monitoring.view.subscribe,
    recording.monitoring.view.get,
  );
  const profile = chosenProfileOf(settings);
  const processing = processingOf(profile);
  const device = view.opened?.device ?? settings.input;
  const standing = calibrationStanding(settings, calibrationPathOf(view, settings));
  return (
    <>
      <p className="ag-editor-asset-name">Recording</p>
      <PropertyGrid
        rows={[
          { id: 'input', label: 'Input', value: deviceName(device) },
          {
            id: 'profile',
            label: 'Capture profile',
            value: `${profile.name}, ${KIND_NAMES[profile.kind]}${profile.headphones ? ', used with headphones' : ''}`,
          },
          {
            id: 'asks',
            label: 'Asks the browser for',
            value: PROCESSING_CONTROLS.map(
              (control) => `${PROCESSING_NAMES[control]} ${processing[control] ? 'on' : 'off'}`,
            ).join('; '),
          },
          {
            id: 'kept',
            label: 'Kept before Record',
            value: settings.retrospective.on
              ? `The last ${String(settings.retrospective.seconds)} seconds, while armed`
              : 'Nothing',
          },
          {
            id: 'count-in',
            label: 'Count-in',
            value:
              settings.countInSeconds === 0 ? 'None' : `${String(settings.countInSeconds)} seconds`,
          },
          { id: 'monitoring', label: 'Monitoring', value: monitoringText(monitoring) },
          {
            id: 'starts-monitoring',
            label: 'Starts monitoring by itself',
            value:
              device !== undefined &&
              profile.headphones &&
              monitoringRemembered(settings, device, profile.name)
                ? 'Yes, with this input and profile'
                : 'No',
          },
          {
            id: 'calibration',
            label: 'Latency calibration',
            value:
              standing.kind === 'current'
                ? 'Calibrated for this input, output and sample rate'
                : standing.kind === 'missing'
                  ? 'Not calibrated'
                  : 'Taken with another path; calibrate again',
          },
        ]}
      />
      <GrantDisclosure comparison={view.opened?.comparison} />
      <CommandButton
        id="settings.open"
        label="Change these in Settings"
        commands={commands}
        compact
      />
    </>
  );
}
