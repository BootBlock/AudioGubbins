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

import { useEffect, useSyncExternalStore, type ReactNode } from 'react';

import { Banner, BannerTone, IconButton, RecordButton } from '@audiogubbins/design-system';
import { quoted } from '@audiogubbins/text';

import { ARM_PUNCH, RECORD, STOP_RECORDING } from '../../commands/take-recording-commands.js';
import type { InputView } from '../../recording/input-view.js';
import type { TakeProgress } from '../../recording/take-progress.js';
import type { RecordingParts } from '../../recording/recording-part.js';
import { recordedText, timeLeftWarning } from '../../recording/take-words.js';
import type { ProjectStores } from '../../state/project-stores.js';
import type { RecordingSettings } from '../../state/recording-settings.js';
import type { PanelCommands } from '../command-button.js';
import { commandPress } from '../command-press.js';
import { TakeTiming } from './take-timing.js';

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

/**
 * The open project's take stacks; and the storage left, read as the panel is
 * shown, so a shortage is told before the input is armed, not only once it is.
 */
function useTakeStacks(
  recording: RecordingParts,
  projects: ProjectStores | undefined,
): ReadonlyMap<string, { readonly name: string }> {
  const open = useSyncExternalStore(
    projects?.project.subscribe ?? NO_PROJECT.subscribe,
    projects?.project.get ?? NO_PROJECT.get,
  );
  const writable = open?.kind === 'open' && open.snapshot.access.kind === 'writable';
  useEffect(() => {
    if (writable && projects !== undefined) recording.arming.read(projects.recordings);
  }, [writable, projects, recording]);
  return open?.kind === 'open' ? open.snapshot.model.state.project.takeStacks : new Map();
}

/**
 * The record lamp, lit while a take is being recorded, what the take records
 * into and how far it has come, and Stop and the punch beside it: the lamp is
 * Record, and each button runs its own command with its own reason.
 */
function RecordDeck({
  progress,
  purpose,
  commands,
}: {
  readonly progress: TakeProgress;
  readonly purpose: string;
  readonly commands: PanelCommands;
}): ReactNode {
  const said = progressText(progress);
  const { onPress: record, ...recordReason } = commandPress(commands, RECORD);
  const { onPress: stop, ...stopReason } = commandPress(commands, STOP_RECORDING);
  const { onPress: punch, ...punchReason } = commandPress(commands, ARM_PUNCH);
  return (
    <div className="ag-recording-deck">
      <RecordButton
        label="Record"
        recording={progress.kind === 'recording'}
        {...recordReason}
        onPress={record}
      />
      <div className="ag-recording-deck-text">
        <p className="ag-recording-purpose">{purpose}</p>
        {said !== undefined && <p className="ag-recording-progress">{said}</p>}
      </div>
      <div className="ag-recording-buttons">
        <IconButton icon="stop" label="Stop" hint="Stop" {...stopReason} onClick={stop} />
        <IconButton
          icon="punch-in"
          label="Arm a punch over the selection"
          hint="Arm a punch over the selection"
          {...punchReason}
          onClick={punch}
        />
      </div>
    </div>
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
  const stacks = useTakeStacks(recording, projects);
  const warning = progress.kind === 'recording' ? undefined : timeLeftWarning(timeLeft);
  return (
    <div className="ag-recording-takes">
      <RecordDeck
        progress={progress}
        purpose={purposeText(view, stacks) ?? 'Arm the input to record a take.'}
        commands={commands}
      />
      {warning !== undefined && (
        <Banner tone={BannerTone.Warning} icon="storage">
          {warning}
        </Banner>
      )}
      <TakeTiming settings={settings} commands={commands} />
    </div>
  );
}
