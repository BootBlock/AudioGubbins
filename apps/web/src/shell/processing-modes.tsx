/**
 * The Transport panel's account of how the engine processes: the mode
 * playback runs in and the mode the offline render runs in, each with its
 * reason (REQ-ARCH-079), playback's being a cached preview, with how far it
 * has been made, where what plays cannot run live (ADR-0061); the render
 * mode the person may set over the automatic choice; the quality each runs
 * at, with every value it stands for and where the two differ
 * (REQ-AUDIO-080, REQ-AUDIO-086); and what the render's resources warned of,
 * with the choice a warning asks for (REQ-ARCH-087).
 *
 * It reads the settings, the render's planning and the preview renders, and
 * changes none of them: every control runs a command (REQ-EDIT-073).
 */

import { useSyncExternalStore, type ReactNode } from 'react';

import { OptionSelect } from '@audiogubbins/design-system';
import { finalRenderSettings, type QualitySettings } from '@audiogubbins/domain';
import {
  CachePurpose,
  JobPriority,
  ProcessingMode,
  ProcessingPurpose,
  RenderPhase,
  selectProcessingMode,
  type LimitingResource,
  type ProcessingModeChoice,
  type RenderReport,
  type RenderStrategy,
  type ResourceWarning,
} from '@audiogubbins/audio-engine';
import type { PreviewRenders } from '@audiogubbins/audio-runtime';

import {
  RENDER_MODE_NAMES,
  RENDER_MODE_SETTINGS,
  renderModeCommandId,
  renderModeSetting,
} from '../commands/audio-settings-commands.js';
import { QUALITY_LEVEL_NAMES, previewDifferenceText, qualitySentence } from '../quality-words.js';
import { previewQualityOf, type AudioSettings } from '../state/audio-settings-store.js';
import type { AudioView } from '../state/audio-view-store.js';
import type { Observable } from '../state/observable.js';
import {
  PlanningStage,
  type RenderPlanning,
  type RenderStrategyView,
} from '../state/render-strategy-store.js';
import { ReasonedButton } from './settings/reasoned-button.js';

/** What the panel reads, and how it runs a command. */
export interface ProcessingModesProps {
  /** The engine's view, whose cached preview renders playback may be reading. */
  readonly audio: Observable<AudioView>;
  readonly settings: Observable<AudioSettings>;
  readonly strategy: Observable<RenderStrategyView>;
  readonly run: (id: string) => void;
  readonly unavailableReason: (id: string) => string | undefined;
}

/**
 * Why playback that can run live does not move to a cached preview when it
 * cannot keep up: nothing measures what live processing costs yet, so the
 * choice never claims a move it will not make. Processing that cannot run
 * live at all plays from a cached preview, which says so instead.
 */
const LIVE_PLAYBACK_UNAVAILABLE: ReadonlyMap<ProcessingMode, string> = new Map([
  [
    ProcessingMode.CachedPreview,
    'nothing measures what live processing costs yet, so processing that can run live plays live.',
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

/** The render playback reads now, where it reads one: the render a playback reader holds. */
function playbackRender(previews: PreviewRenders): RenderReport | undefined {
  return previews.renders.find((render) => render.purposes.includes(CachePurpose.Playback));
}

/** How far a cached preview has been made, as a sentence. */
function previewProgressText(render: RenderReport): string {
  switch (render.phase) {
    case RenderPhase.Queued:
      return 'It is waiting for another preview to be made first.';
    case RenderPhase.Making:
      return render.reached === 0
        ? 'It is being made: anything that measures the whole sound measures it first.'
        : `It is being made: ${String(Math.floor((render.reached / Math.max(1, render.length)) * 100))}% so far.`;
    case RenderPhase.Made:
      return 'It is made, and plays from memory.';
    case RenderPhase.Failed:
      return `It could not be made: ${render.failure ?? 'no reason was given.'}`;
  }
}

/**
 * The mode playback runs in: from a cached preview where what plays cannot
 * run live, and live otherwise, where nothing measures its cost yet, so the
 * choice says so rather than inventing one.
 */
function playbackChoice(
  settings: AudioSettings,
  render: RenderReport | undefined,
): ProcessingModeChoice | undefined {
  const chosen = selectProcessingMode({
    purpose: ProcessingPurpose.Monitor,
    settings: settings.chosen.settings,
    ...(render?.reason === undefined
      ? { unavailable: LIVE_PLAYBACK_UNAVAILABLE }
      : { cannotRunLive: render.reason }),
  });
  return chosen.ok ? chosen.value : undefined;
}

/** How far the cached preview playback reads has been made, read out in tenths. */
function PreviewProgress({ render }: { readonly render: RenderReport }): ReactNode {
  const tenths = Math.floor((render.reached / Math.max(1, render.length)) * 10) * 10;
  return (
    <>
      <progress
        className="ag-render-progress"
        aria-label="Cached preview made"
        max={render.length}
        value={render.reached}
      />
      <p role="status" className="ag-panel-note">
        {render.phase === RenderPhase.Making ? `Making the preview: ${String(tenths)}%` : ''}
      </p>
    </>
  );
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

/** A quality mode's level, and every value it runs at, as a reading. */
function QualityReading({
  term,
  level,
  settings,
  after = '',
}: {
  readonly term: string;
  readonly level: string;
  readonly settings: QualitySettings;
  readonly after?: string;
}): ReactNode {
  return (
    <div className="ag-reading">
      <dt>{term}</dt>
      <dd>
        {level}
        <span className="ag-reading-note">{`${qualitySentence(settings)}${after}`}</span>
      </dd>
    </div>
  );
}

/** The quality a render and playback run at, and where what plays is not what a render makes. */
function Quality({ settings }: { readonly settings: AudioSettings }): ReactNode {
  const render = finalRenderSettings(settings.renderQuality);
  const preview = previewQualityOf(settings);
  return (
    <>
      <dl className="ag-readings" aria-label="Quality">
        <QualityReading
          term="Render quality"
          level={QUALITY_LEVEL_NAMES[settings.renderQuality.level]}
          settings={render}
        />
        <QualityReading
          term="Preview quality"
          level={QUALITY_LEVEL_NAMES[preview.level]}
          settings={preview.settings}
          after={settings.previewQuality === undefined ? ' Chosen by the performance profile.' : ''}
        />
      </dl>
      <p className="ag-panel-note">{previewDifferenceText(preview.settings, render)}</p>
    </>
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
  const { previews } = useSyncExternalStore(props.audio.subscribe, props.audio.get);
  const cached = playbackRender(previews);
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
        <ModeReading
          term="Playback"
          choice={playbackChoice(settings, cached)}
          after={cached === undefined ? '' : ` ${previewProgressText(cached)}`}
        />
        <ModeReading
          term="Offline render"
          choice={render?.choice}
          after={priorityText(render?.priority)}
        />
      </dl>
      {cached !== undefined && <PreviewProgress render={cached} />}
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
      <Quality settings={settings} />
      <Warnings warnings={warnings} />
      {planning.stage === PlanningStage.AwaitingDecision && (
        <Decision safer={planning.assessment.safer} commands={props} />
      )}
    </div>
  );
}
