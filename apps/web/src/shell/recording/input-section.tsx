/**
 * The Recording panel's input: which input, whether the microphone is allowed,
 * the arm and disarm control, the profile and what the browser granted against
 * what it asked for (`REQ-REC-092`), the retrospective buffer, and the input's
 * levels with their spoken form.
 *
 * The grant is disclosed progressively: the profile and whether everything
 * asked for was granted first, and each difference and what it does to the
 * recording on request.
 */

import type { ReactNode } from 'react';

import {
  Badge,
  Button,
  ButtonTone,
  Icon,
  type IconName,
  IconSize,
  OptionSelect,
  VisuallyHidden,
} from '@audiogubbins/design-system';
import type { CaptureComparison } from '@audiogubbins/recording';

import { CHOOSE_INPUT } from '../../commands/recording-commands.js';
import { identityOfDevice } from '../../recording/capture-facts.js';
import type { InputView } from '../../recording/input-view.js';
import type { RecordingParts } from '../../recording/recording-part.js';
import {
  deviceName,
  permissionText,
  bufferShortfallText,
} from '../../recording/recording-words.js';
import type { RecordingSettings } from '../../state/recording-settings.js';
import { CommandButton, type PanelCommands } from '../command-button.js';
import { commandPress } from '../command-press.js';
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

/** The retrospective buffer, as set, as the memory left allows it, and as it holds now. */
function bufferText(settings: RecordingSettings, view: InputView): string {
  if (!settings.retrospective.on) return 'Nothing is kept from before Record.';
  const shortfall = bufferShortfallText(view.buffer);
  if (view.buffer?.kind === 'none' && shortfall !== undefined) return shortfall;
  const kept =
    shortfall ??
    `The last ${String(settings.retrospective.seconds)} seconds are kept in memory while the input is armed, and written nowhere until you record.`;
  return view.opened === undefined
    ? kept
    : `${kept} It holds ${String(view.bufferedSeconds)} seconds now.`;
}

/** The glyph of what the microphone permission is, and whether it stands in recording's way. */
const PERMISSION_LOOKS: Readonly<
  Record<InputView['permission'], { readonly icon: IconName; readonly refused: boolean }>
> = {
  granted: { icon: 'checked', refused: false },
  prompt: { icon: 'information', refused: false },
  denied: { icon: 'refused', refused: true },
  unknown: { icon: 'information', refused: false },
};

/** What the browser granted against what was asked, disclosed on request. */
export function GrantDisclosure({
  comparison,
}: {
  readonly comparison: CaptureComparison | undefined;
}): ReactNode {
  if (comparison === undefined) {
    return (
      <p className="ag-recording-caption">
        What the browser grants is known once the input is armed.
      </p>
    );
  }
  const meanings = [
    ...comparison.differences.map((difference) => difference.meaning),
    ...comparison.uncontrollable.map((one) => one.meaning),
  ];
  if (meanings.length === 0) {
    return (
      <p className="ag-recording-caption">The browser granted everything the profile asked for.</p>
    );
  }
  return (
    <details className="ag-recording-disclosure">
      <summary>
        <Icon name="expand" size={IconSize.Inline} className="ag-recording-disclosure-chevron" />
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

/** One line of what is known of the input, led by its glyph. */
function Fact({
  icon,
  status,
  children,
}: {
  readonly icon: IconName;
  readonly status?: 'reduced';
  readonly children: string;
}): ReactNode {
  return (
    <li className="ag-recording-fact" data-ag-status={status}>
      <Icon name={icon} size={IconSize.Inline} />
      <span>{children}</span>
    </li>
  );
}

/**
 * The input's levels, read once a display frame while it is open, in a well
 * with the control that says them.
 */
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
    <div className="ag-recording-meters">
      {levels === undefined ? (
        <p className="ag-recording-caption">No levels until an input is armed.</p>
      ) : (
        <LevelGroup label="Input levels" levels={levels} />
      )}
      <div className="ag-recording-meters-actions">
        <CommandButton
          id="recording.say-levels"
          label="Say the levels"
          tone={ButtonTone.Quiet}
          commands={commands}
          compact
        />
      </div>
    </div>
  );
}

/** Which input records, and the controls that arm and disarm it. */
function DeviceRow({
  view,
  settings,
  commands,
}: {
  readonly view: InputView;
  readonly settings: RecordingSettings;
  readonly commands: PanelCommands;
}): ReactNode {
  const listed = view.devices.flatMap((device) => identityOfDevice(device) ?? []);
  const chosen = view.opened?.device ?? settings.input;
  const { onPress: arm, ...armReason } = commandPress(commands, 'recording.arm');
  const { onPress: disarm, ...disarmReason } = commandPress(commands, 'recording.disarm');
  return (
    <div className="ag-recording-device">
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
        <p className="ag-recording-device-name">{deviceName(chosen)}</p>
      )}
      <div className="ag-recording-buttons">
        <Button compact {...armReason} onClick={arm}>
          <Icon name="armed" />
          Arm
        </Button>
        <Button compact {...disarmReason} onClick={disarm}>
          Disarm
        </Button>
      </div>
    </div>
  );
}

/** What is known of the input: the permission, the session, a problem and the buffer. */
function InputFacts({
  view,
  settings,
}: {
  readonly view: InputView;
  readonly settings: RecordingSettings;
}): ReactNode {
  const permission = PERMISSION_LOOKS[view.permission];
  return (
    <ul className="ag-recording-facts">
      <Fact icon={permission.icon} {...(permission.refused ? { status: 'reduced' as const } : {})}>
        {permissionText(view.permission)}
      </Fact>
      <Fact icon="recorder">{sessionText(view)}</Fact>
      {view.problem !== undefined && (
        <Fact icon="warning" status="reduced">
          {view.problem}
        </Fact>
      )}
      <Fact icon="pre-record">{bufferText(settings, view)}</Fact>
    </ul>
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
  return (
    <div className="ag-recording-input">
      <DeviceRow view={view} settings={settings} commands={commands} />
      <div className="ag-recording-chips">
        <Badge>
          <VisuallyHidden>Capture profile: </VisuallyHidden>
          {settings.chosenProfile}
        </Badge>
      </div>
      <InputFacts view={view} settings={settings} />
      <GrantDisclosure comparison={view.opened?.comparison} />
      <InputLevels recording={recording} open={view.opened !== undefined} commands={commands} />
    </div>
  );
}
