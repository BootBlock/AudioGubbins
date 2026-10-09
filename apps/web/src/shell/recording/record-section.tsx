/**
 * The Recording panel's takes as they are made (`REQ-REC-020`, `REQ-REC-093`,
 * `REQ-UX-005`): what the armed input records for, Record and Stop, a punch
 * armed over the selection, how far the take has come and how much storage is
 * left, and the punch's pre-roll and post-roll, the timed stop and a start at a
 * set time.
 *
 * Each control runs a command, so the menus, the palette and a shortcut make
 * the same take; what a take has come to is said as it changes.
 */

import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';

import { Button, TextField } from '@audiogubbins/design-system';
import { SUSPENSION_CAUTION } from '@audiogubbins/recording';
import { quoted } from '@audiogubbins/text';

import {
  ARM_PUNCH,
  RECORD,
  RECORD_AT,
  SET_PUNCH_ROLLS,
  SET_TIMED_STOP,
  STOP_RECORDING,
} from '../../commands/take-recording-commands.js';
import type { InputView } from '../../recording/input-view.js';
import type { TakeProgress } from '../../recording/take-progress.js';
import type { RecordingParts } from '../../recording/recording-part.js';
import { recordedText, timeLeftWarning } from '../../recording/take-words.js';
import type { ProjectStores } from '../../state/project-stores.js';
import {
  LONGEST_PUNCH_ROLL_SECONDS,
  LONGEST_TIMED_SECONDS,
  type RecordingSettings,
} from '../../state/recording-settings.js';
import { CommandButton, useCommandReasons, type PanelCommands } from '../command-button.js';
import { typed } from '../settings/recording-input.js';

const NO_PROJECT = { get: () => undefined, subscribe: () => () => undefined };

/** What the armed input records for, in words. */
function purposeText(
  view: InputView,
  stacks: ReadonlyMap<string, { readonly name: string }>,
): string | undefined {
  const { session } = view;
  if (!('purpose' in session)) return undefined;
  const { purpose } = session;
  switch (purpose.kind) {
    case 'new-stack':
      return 'The next take starts a new take stack.';
    case 'take': {
      const stack = stacks.get(purpose.stack);
      return stack === undefined
        ? 'The next take goes into a stack no longer in the project.'
        : `The next take goes into ${quoted(stack.name)}.`;
    }
    case 'punch':
      return 'The next take punches in over the selected range, with its pre-roll and post-roll.';
  }
}

/** How far the take has come, in words. */
function progressText(progress: TakeProgress): string | undefined {
  switch (progress.kind) {
    case 'idle':
      return undefined;
    case 'scheduled':
      return 'A recording is scheduled. Keep this page open and in view until it ends.';
    case 'pre-roll':
      return `Playing the pre-roll before ${quoted(progress.take)}.`;
    case 'recording': {
      const recorded = `Recording ${quoted(progress.take)}: ${recordedText(progress.committed / progress.rate)} kept.`;
      const lost =
        progress.lost.frames > 0
          ? ` ${recordedText(progress.lost.frames / progress.rate)} could not be kept and is silence.`
          : '';
      const warning = timeLeftWarning(progress.timeLeft);
      return `${recorded}${lost}${warning === undefined ? '' : ` ${warning}`}`;
    }
    case 'finishing':
      return `Finishing ${quoted(progress.take)}.`;
  }
}

/** The punch's rolls, the timed stop and a set start. */
function TakeTiming({
  settings,
  commands,
}: {
  readonly settings: RecordingSettings;
  readonly commands: PanelCommands;
}): ReactNode {
  const [preRoll, setPreRoll] = useState(String(settings.punchPreRollSeconds));
  const [postRoll, setPostRoll] = useState(String(settings.punchPostRollSeconds));
  const [stopAfter, setStopAfter] = useState(String(settings.stopAfterSeconds));
  const [startAt, setStartAt] = useState('');
  const applyRolls = (): void => {
    commands.run(SET_PUNCH_ROLLS, { preRoll: typed(preRoll), postRoll: typed(postRoll) });
  };
  const applyStop = (): void => {
    commands.run(SET_TIMED_STOP, { seconds: typed(stopAfter) });
  };
  const recordAt = (): void => {
    commands.run(RECORD_AT, { time: startAt });
  };
  return (
    <details>
      <summary>Pre-roll, post-roll and timed recording</summary>
      <TextField
        label={`Punch pre-roll, in seconds, up to ${String(LONGEST_PUNCH_ROLL_SECONDS)}`}
        value={preRoll}
        onValueChange={setPreRoll}
        onSubmit={applyRolls}
      />
      <TextField
        label={`Punch post-roll, in seconds, up to ${String(LONGEST_PUNCH_ROLL_SECONDS)}`}
        value={postRoll}
        onValueChange={setPostRoll}
        onSubmit={applyRolls}
      />
      <Button onClick={applyRolls}>Apply the pre-roll and post-roll</Button>
      <TextField
        label={`Stop recording after, in seconds, up to ${String(LONGEST_TIMED_SECONDS)}; 0 for no timed stop`}
        value={stopAfter}
        onValueChange={setStopAfter}
        onSubmit={applyStop}
      />
      <Button onClick={applyStop}>Apply the timed stop</Button>
      <TextField
        label="Start recording at, as hours and minutes"
        value={startAt}
        onValueChange={setStartAt}
        onSubmit={recordAt}
      />
      <Button onClick={recordAt}>Record at this time</Button>
      <p className="ag-panel-note">{SUSPENSION_CAUTION}</p>
    </details>
  );
}

/** The takes as they are made, in the Recording panel. */
export function RecordSection({
  recording,
  view,
  settings,
  projects,
  commands,
}: {
  readonly recording: RecordingParts;
  readonly view: InputView;
  readonly settings: RecordingSettings;
  readonly projects: ProjectStores | undefined;
  readonly commands: PanelCommands;
}): ReactNode {
  const progress = useSyncExternalStore(
    recording.takes.progress.subscribe,
    recording.takes.progress.get,
  );
  const timeLeft = useSyncExternalStore(
    recording.arming.timeLeft.subscribe,
    recording.arming.timeLeft.get,
  );
  const open = useSyncExternalStore(
    projects?.project.subscribe ?? NO_PROJECT.subscribe,
    projects?.project.get ?? NO_PROJECT.get,
  );
  const stacks = open?.kind === 'open' ? open.snapshot.model.state.project.takeStacks : new Map();
  const writable = open?.kind === 'open' && open.snapshot.access.kind === 'writable';
  // The storage left is read as the panel is shown, so a shortage is told
  // before the input is armed, not only once it is.
  useEffect(() => {
    if (writable && projects !== undefined) recording.arming.read(projects.recordings);
  }, [writable, projects, recording]);
  const shared = useCommandReasons(commands, [RECORD, STOP_RECORDING]);
  const said = progressText(progress);
  const warning = progress.kind === 'recording' ? undefined : timeLeftWarning(timeLeft);
  return (
    <div>
      <h3>Takes</h3>
      <p>{purposeText(view, stacks) ?? 'Arm the input to record a take.'}</p>
      <div className="ag-settings-row">
        <CommandButton
          id={RECORD}
          label="Record"
          commands={commands}
          shared={shared}
          tone="primary"
        />
        <CommandButton id={STOP_RECORDING} label="Stop" commands={commands} shared={shared} />
      </div>
      <CommandButton
        id={ARM_PUNCH}
        label="Arm a punch over the selection"
        commands={commands}
        compact
      />
      {said !== undefined && <p>{said}</p>}
      {warning !== undefined && <p data-ag-status="reduced">{warning}</p>}
      <TakeTiming settings={settings} commands={commands} />
    </div>
  );
}
