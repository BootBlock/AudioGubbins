/**
 * The Transport panel's account of how the engine processes: the mode
 * playback runs in and the mode the offline render runs in, each with its
 * reason (REQ-ARCH-079); the render mode the person may set over the
 * automatic choice; and what the render's resources warned of, with the
 * choice a warning asks for (REQ-ARCH-087).
 *
 * It reads the settings and the render's planning and changes neither: every
 * control runs a command (REQ-EDIT-073).
 */

import { useSyncExternalStore, type ReactNode } from 'react';

import { OptionSelect } from '@audiogubbins/design-system';
import {
  JobPriority,
  ProcessingMode,
  ProcessingPurpose,
  selectProcessingMode,
  type LimitingResource,
  type ProcessingModeChoice,
  type RenderStrategy,
  type ResourceWarning,
} from '@audiogubbins/audio-engine';

import {
  RENDER_MODE_NAMES,
  RENDER_MODE_SETTINGS,
  renderModeCommandId,
  renderModeSetting,
} from '../commands/audio-settings-commands.js';
import type { AudioSettings, AudioSettingsStore } from '../state/audio-settings-store.js';
import {
  PlanningStage,
  type RenderPlanning,
  type RenderStrategyStore,
} from '../state/render-strategy-store.js';
import { ReasonedButton } from './settings/reasoned-button.js';

/** What the panel reads, and how it runs a command. */
export interface ProcessingModesProps {
  readonly settings: AudioSettingsStore;
  readonly strategy: RenderStrategyStore;
  readonly run: (id: string) => void;
  readonly unavailableReason: (id: string) => string | undefined;
}

/**
 * The modes playback cannot run in this build, and why: nothing renders a
 * preview ahead of playback yet, so playback never claims to use one.
 */
const PLAYBACK_UNAVAILABLE: ReadonlyMap<ProcessingMode, string> = new Map([
  [
    ProcessingMode.CachedPreview,
    'nothing in AudioGubbins renders a preview ahead of playback yet, so what you hear is processed as it plays.',
  ],
]);

/** What each mode is called, standing alone as it does in a reading. */
const MODE_NAMES: Readonly<Record<ProcessingMode, string>> = {
  [ProcessingMode.RealTime]: 'Real-time processing',
  [ProcessingMode.CachedPreview]: 'Cached preview',
  [ProcessingMode.BackgroundOffline]: 'Background rendering',
  [ProcessingMode.FinalOffline]: 'Final offline rendering',
};

/** What each limiting resource is called, at the head of its warning. */
const RESOURCE_NAMES: Readonly<Record<LimitingResource, string>> = {
  memory: 'Memory',
  storage: 'Storage',
  compute: 'Processor',
};

/**
 * The mode playback runs in. Playback processes the test signal live; nothing
 * measures its cost yet, so the choice says so rather than inventing one.
 */
function playbackChoice(settings: AudioSettings): ProcessingModeChoice | undefined {
  const chosen = selectProcessingMode({
    purpose: ProcessingPurpose.Monitor,
    settings: settings.chosen.settings,
    unavailable: PLAYBACK_UNAVAILABLE,
  });
  return chosen.ok ? chosen.value : undefined;
}

/**
 * The mode the render runs in: the one it was planned with once a render has
 * been asked for, and before that the one the next would take. Before any
 * render nothing has been measured, and memory never moves the mode, so the
 * choice made without the resources is the one planning would make.
 */
function renderChoice(
  settings: AudioSettings,
  planning: RenderPlanning,
): { readonly choice: ProcessingModeChoice; readonly priority?: JobPriority } | undefined {
  if (planning.stage === PlanningStage.Decided) return planning.strategy;
  if (planning.stage === PlanningStage.AwaitingDecision) return planning.assessment.strategy;
  const chosen = selectProcessingMode({
    purpose: ProcessingPurpose.FinalRender,
    settings: settings.chosen.settings,
    ...(settings.renderMode === undefined ? {} : { override: settings.renderMode }),
  });
  return chosen.ok ? { choice: chosen.value } : undefined;
}

function priorityText(priority: JobPriority | undefined): string {
  if (priority === undefined) return '';
  return priority === JobPriority.Background
    ? ' Queued behind playback, editing and work you are waiting on.'
    : ' Queued ahead of background work.';
}

/** A mode, and why it was chosen, as a reading. */
function ModeReading({
  term,
  choice,
  after = '',
}: {
  readonly term: string;
  readonly choice: ProcessingModeChoice | undefined;
  readonly after?: string;
}): ReactNode {
  return (
    <div className="ag-reading">
      <dt>{term}</dt>
      <dd>
        {choice === undefined ? 'Not known' : MODE_NAMES[choice.mode]}
        {choice !== undefined && (
          <span className="ag-reading-note">{`${choice.reason}${after}`}</span>
        )}
      </dd>
    </div>
  );
}

/** What the render's resources warned of, each naming the resource that limits it. */
function Warnings({ warnings }: { readonly warnings: readonly ResourceWarning[] }): ReactNode {
  if (warnings.length === 0) return null;
  return (
    <ul className="ag-render-warnings" aria-label="What the render was warned of">
      {warnings.map((warning) => (
        <li key={warning.resource} data-ag-status="reduced">
          <strong>{`${RESOURCE_NAMES[warning.resource]}. `}</strong>
          {`${warning.explanation} ${warning.saferStrategy}`}
        </li>
      ))}
    </ul>
  );
}

/** The two ways a render waiting on a warning can go, each through its command. */
function Decision({
  safer,
  commands,
}: {
  readonly safer: RenderStrategy;
  readonly commands: Pick<ProcessingModesProps, 'run' | 'unavailableReason'>;
}): ReactNode {
  return (
    <div className="ag-render-decision" role="group" aria-label="How to render">
      <p className="ag-panel-note">{safer.choice.reason}</p>
      <ReasonedButton
        reason={commands.unavailableReason('transport.render-safer')}
        onPress={() => {
          commands.run('transport.render-safer');
        }}
      >
        Render in the background
      </ReasonedButton>
      <ReasonedButton
        reason={commands.unavailableReason('transport.render-as-chosen')}
        onPress={() => {
          commands.run('transport.render-as-chosen');
        }}
      >
        Render as chosen
      </ReasonedButton>
    </div>
  );
}

/** How the engine processes, and the choices a person has over it. */
export function ProcessingModes(props: ProcessingModesProps): ReactNode {
  const settings = useSyncExternalStore(props.settings.subscribe, props.settings.get);
  const { planning } = useSyncExternalStore(props.strategy.subscribe, props.strategy.get);
  const render = renderChoice(settings, planning);
  const warnings =
    planning.stage === PlanningStage.Decided
      ? planning.strategy.plan.warnings
      : planning.stage === PlanningStage.AwaitingDecision
        ? planning.assessment.strategy.plan.warnings
        : [];
  const setting = renderModeSetting(settings.renderMode);
  return (
    <div className="ag-transport-section">
      <h3 className="ag-transport-heading">Processing</h3>
      <dl className="ag-readings">
        <ModeReading term="Playback" choice={playbackChoice(settings)} />
        <ModeReading
          term="Offline render"
          choice={render?.choice}
          after={priorityText(render?.priority)}
        />
      </dl>
      <OptionSelect
        label="Render mode"
        value={setting}
        options={RENDER_MODE_SETTINGS.map((one) => ({
          value: one,
          label: RENDER_MODE_NAMES[one],
        }))}
        onValueChange={(value) => {
          const chosen = RENDER_MODE_SETTINGS.find((one) => one === value);
          if (chosen !== undefined && chosen !== setting) props.run(renderModeCommandId(chosen));
        }}
      />
      <Warnings warnings={warnings} />
      {planning.stage === PlanningStage.AwaitingDecision && (
        <Decision safer={planning.assessment.safer} commands={props} />
      )}
    </div>
  );
}
