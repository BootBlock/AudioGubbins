/**
 * The Recording panel's input: which input, whether the microphone is
 * allowed, the arm and disarm control, the profile and what the browser
 * granted against what it asked for (`REQ-REC-092`), the retrospective buffer,
 * and the input's levels with their spoken form.
 *
 * The grant is disclosed progressively: the profile and whether everything
 * asked for was granted first, and each difference and what it does to the
 * recording on request.
 */

import type { ReactNode } from 'react';

import { OptionSelect } from '@audiogubbins/design-system';
import type { CaptureComparison } from '@audiogubbins/recording';

import { CHOOSE_INPUT } from '../../commands/recording-commands.js';
import { identityOfDevice } from '../../recording/capture-facts.js';
import type { InputView } from '../../recording/input-view.js';
import type { RecordingParts } from '../../recording/recording-part.js';
import { deviceName, permissionText } from '../../recording/recording-words.js';
import type { RecordingSettings } from '../../state/recording-settings.js';
import { CommandButton, useCommandReasons, type PanelCommands } from '../command-button.js';
import { LevelGroup } from '../engine-readouts.js';
import { useDisplayFrame } from '../use-display-frame.js';

/** The session's state in words, for the panel. */
function sessionText(view: InputView): string {
  const { session } = view;
  switch (session.kind) {
    case 'closed':
    case 'ready':
      return 'The input is closed: nothing is captured or kept.';
    case 'asking':
      return 'The browser is asking for the microphone.';
    case 'armed':
      return session.input.kind === 'opening'
        ? 'The input is opening.'
        : 'The input is armed. Nothing is recorded until you record.';
    case 'counting-in':
      return 'Counting in.';
    case 'recording':
      return 'Recording.';
    case 'stopping':
      return 'Finishing the recording.';
    case 'failed':
      return `Recording cannot go on: ${session.failure.summary}`;
  }
}

/** The retrospective buffer, as set and as it holds now. */
function bufferText(settings: RecordingSettings, view: InputView): string {
  if (!settings.retrospective.on) return 'Nothing is kept from before Record.';
  const kept = `The last ${String(settings.retrospective.seconds)} seconds are kept in memory while the input is armed, and written nowhere until you record.`;
  return view.opened === undefined
    ? kept
    : `${kept} It holds ${String(view.bufferedSeconds)} seconds now.`;
}

/** What the browser granted against what was asked, disclosed on request. */
export function GrantDisclosure({
  comparison,
}: {
  readonly comparison: CaptureComparison | undefined;
}): ReactNode {
  if (comparison === undefined) {
    return (
      <p className="ag-panel-note">What the browser grants is known once the input is armed.</p>
    );
  }
  const meanings = [
    ...comparison.differences.map((difference) => difference.meaning),
    ...comparison.uncontrollable.map((one) => one.meaning),
  ];
  if (meanings.length === 0) {
    return <p>The browser granted everything the profile asked for.</p>;
  }
  return (
    <details>
      <summary>
        {meanings.length === 1
          ? 'The browser granted one thing other than asked'
          : `The browser granted ${String(meanings.length)} things other than asked`}
      </summary>
      <ul>
        {meanings.map((meaning) => (
          <li key={meaning}>{meaning}</li>
        ))}
      </ul>
    </details>
  );
}

/** The input's levels, read once a display frame while it is open, and the control that says them. */
function InputLevels({
  recording,
  open,
  commands,
}: {
  readonly recording: RecordingParts;
  readonly open: boolean;
  readonly commands: PanelCommands;
}): ReactNode {
  const levels = useDisplayFrame(() => recording.input.meters(), open);
  return (
    <>
      {levels === undefined ? (
        <p className="ag-panel-note">No levels until an input is armed.</p>
      ) : (
        <LevelGroup label="Input levels" levels={levels} />
      )}
      <CommandButton id="recording.say-levels" label="Say the levels" commands={commands} compact />
    </>
  );
}

/** The input part of the Recording panel. */
export function InputSection({
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
  const shared = useCommandReasons(commands, ['recording.arm', 'recording.disarm']);
  const listed = view.devices.flatMap((device) => identityOfDevice(device) ?? []);
  const chosen = view.opened?.device ?? settings.input;
  return (
    <div>
      <h3>Input</h3>
      {listed.length > 0 ? (
        <OptionSelect
          label="Input"
          value={chosen?.id ?? ''}
          options={[
            ...(chosen === undefined ? [{ value: '', label: deviceName(undefined) }] : []),
            ...listed.map((device) => ({ value: device.id, label: deviceName(device) })),
          ]}
          onValueChange={(device) => {
            if (device !== '' && device !== chosen?.id) commands.run(CHOOSE_INPUT, { device });
          }}
        />
      ) : (
        <p>{deviceName(chosen)}</p>
      )}
      <p className="ag-panel-note">{permissionText(view.permission)}</p>
      <p>{sessionText(view)}</p>
      {view.problem !== undefined && <p data-ag-status="reduced">{view.problem}</p>}
      <div className="ag-settings-row">
        <CommandButton id="recording.arm" label="Arm" commands={commands} shared={shared} />
        <CommandButton id="recording.disarm" label="Disarm" commands={commands} shared={shared} />
      </div>
      <p>{`Capture profile: ${settings.chosenProfile}.`}</p>
      <GrantDisclosure comparison={view.opened?.comparison} />
      <p>{bufferText(settings, view)}</p>
      <InputLevels recording={recording} open={view.opened !== undefined} commands={commands} />
    </div>
  );
}
