/**
 * The Recording panel's timing of a take (`REQ-REC-093`): the punch's
 * pre-roll and post-roll, the timed stop and a start at a set time, each
 * typed and applied by its command, in a section that starts closed since
 * they are set now and then rather than for every take.
 */

import { useState, type ReactNode } from 'react';

import { Button, Section, TextField } from '@audiogubbins/design-system';
import { SUSPENSION_CAUTION } from '@audiogubbins/recording';

import {
  RECORD_AT,
  SET_PUNCH_ROLLS,
  SET_TIMED_STOP,
} from '../../commands/take-recording-commands.js';
import {
  LONGEST_PUNCH_ROLL_SECONDS,
  LONGEST_TIMED_SECONDS,
  type RecordingSettings,
} from '../../state/recording-settings.js';
import type { PanelCommands } from '../command-button.js';
import { typed } from '../settings/recording-input.js';

/** A typed value's apply button, at the form's trailing end. */
function Apply({
  label,
  onPress,
}: {
  readonly label: string;
  readonly onPress: () => void;
}): ReactNode {
  return (
    <div className="ag-recording-actions">
      <Button compact onClick={onPress}>
        {label}
      </Button>
    </div>
  );
}

/** The punch's pre-roll and post-roll, applied together. */
function PunchRolls({
  settings,
  commands,
}: {
  readonly settings: RecordingSettings;
  readonly commands: PanelCommands;
}): ReactNode {
  const [preRoll, setPreRoll] = useState(String(settings.punchPreRollSeconds));
  const [postRoll, setPostRoll] = useState(String(settings.punchPostRollSeconds));
  const applyRolls = (): void => {
    commands.run(SET_PUNCH_ROLLS, { preRoll: typed(preRoll), postRoll: typed(postRoll) });
  };
  return (
    <>
      <TextField
        label={`Punch pre-roll, in seconds, up to ${String(LONGEST_PUNCH_ROLL_SECONDS)}`}
        unit="s"
        value={preRoll}
        onValueChange={setPreRoll}
        onSubmit={applyRolls}
      />
      <TextField
        label={`Punch post-roll, in seconds, up to ${String(LONGEST_PUNCH_ROLL_SECONDS)}`}
        unit="s"
        value={postRoll}
        onValueChange={setPostRoll}
        onSubmit={applyRolls}
      />
      <Apply label="Apply the pre-roll and post-roll" onPress={applyRolls} />
    </>
  );
}

/** The timed stop. */
function TimedStop({
  settings,
  commands,
}: {
  readonly settings: RecordingSettings;
  readonly commands: PanelCommands;
}): ReactNode {
  const [stopAfter, setStopAfter] = useState(String(settings.stopAfterSeconds));
  const applyStop = (): void => {
    commands.run(SET_TIMED_STOP, { seconds: typed(stopAfter) });
  };
  return (
    <>
      <TextField
        label={`Stop recording after, in seconds, up to ${String(LONGEST_TIMED_SECONDS)}; 0 for no timed stop`}
        unit="s"
        value={stopAfter}
        onValueChange={setStopAfter}
        onSubmit={applyStop}
      />
      <Apply label="Apply the timed stop" onPress={applyStop} />
    </>
  );
}

/** A start at a set time. */
function StartAt({ commands }: { readonly commands: PanelCommands }): ReactNode {
  const [startAt, setStartAt] = useState('');
  const recordAt = (): void => {
    commands.run(RECORD_AT, { time: startAt });
  };
  return (
    <>
      <TextField
        label="Start recording at, as hours and minutes"
        value={startAt}
        onValueChange={setStartAt}
        onSubmit={recordAt}
      />
      <Apply label="Record at this time" onPress={recordAt} />
    </>
  );
}

/** The punch's rolls, the timed stop and a set start. */
export function TakeTiming({
  settings,
  commands,
}: {
  readonly settings: RecordingSettings;
  readonly commands: PanelCommands;
}): ReactNode {
  return (
    <Section title="Pre-roll, post-roll and timed recording" defaultOpen={false}>
      <div className="ag-recording-form">
        <PunchRolls settings={settings} commands={commands} />
        <TimedStop settings={settings} commands={commands} />
        <StartAt commands={commands} />
      </div>
      <p className="ag-recording-caption">{SUSPENSION_CAUTION}</p>
    </Section>
  );
}
