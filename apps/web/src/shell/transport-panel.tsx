/**
 * The Transport panel: the test signal played through the engine and its
 * graph, rendered offline, and everything the engine reports while it does.
 *
 * Every control runs a command, so a button here and the palette entry of
 * the same name are one action with one reason when it cannot run
 * (REQ-EDIT-073); the panel reads the engine's view and changes nothing
 * itself. A control whose feature this browser lacks stays on screen,
 * unavailable, with the reason beside it (WU-03.E).
 */

import { useSyncExternalStore, type ReactNode } from 'react';

import { Button, ButtonTone } from '@audiogubbins/design-system';
import type { CapabilityRegistry } from '@audiogubbins/capabilities';
import { TransportMode } from '@audiogubbins/audio-engine';

import { TEST_SIGNAL } from '../audio/test-signal.js';
import type { AudioSettingsStore } from '../state/audio-settings-store.js';
import {
  RenderStage,
  type AudioView,
  type AudioViewStore,
  type RenderResult,
} from '../state/audio-view-store.js';
import type { RenderStrategyStore } from '../state/render-strategy-store.js';
import {
  durationText,
  dspText,
  fingerprintText,
  framesText,
  positionText,
} from '../audio-format.js';
import {
  AudioDegradations,
  EngineState,
  LevelMeters,
  PlaybackProblems,
} from './engine-readouts.js';
import { PerformanceChoice } from './performance-choice.js';
import { ProcessingModes } from './processing-modes.js';
import { usePlayhead } from './use-playhead.js';

/** What the panel reads, and how it runs a command. */
export interface TransportPanelProps {
  readonly title: string;
  readonly audio: AudioViewStore;
  /** The person's audio settings: the profile, and the render mode. */
  readonly audioSettings: AudioSettingsStore;
  /** How the latest render was planned. */
  readonly renderStrategy: RenderStrategyStore;
  readonly capabilities: CapabilityRegistry;
  /** The frame the listener hears now, at the context's rate. */
  readonly playhead: () => number | undefined;
  readonly run: (id: string) => void;
  /** Why a command cannot run now, or `undefined`, as the menus say it. */
  readonly unavailableReason: (id: string) => string | undefined;
}

type Commands = Pick<TransportPanelProps, 'run' | 'unavailableReason'>;

/** A button that runs a command, disabled with the command's own reason. */
function CommandButton({
  id,
  label,
  commands,
  tone,
}: {
  readonly id: string;
  readonly label: string;
  readonly commands: Commands;
  readonly tone?: ButtonTone;
}): ReactNode {
  const reason = commands.unavailableReason(id);
  return (
    <Button
      {...(tone === undefined ? {} : { tone })}
      disabled={reason !== undefined}
      title={reason}
      onClick={() => {
        commands.run(id);
      }}
    >
      {label}
    </Button>
  );
}

/** Play, Pause and Stop, and where playback is. */
function TransportControls({
  view,
  playhead,
  commands,
}: {
  readonly view: AudioView;
  readonly playhead: () => number | undefined;
  readonly commands: Commands;
}): ReactNode {
  const mode = view.playback?.transport.mode;
  const frame = usePlayhead(playhead, mode === TransportMode.Playing);
  const rate = view.playback?.device?.sampleRate;
  return (
    <div className="ag-transport-controls" role="group" aria-label="Transport">
      <CommandButton
        id="transport.play-test-signal"
        label="Play"
        tone={ButtonTone.Primary}
        commands={commands}
      />
      <CommandButton id="transport.pause" label="Pause" commands={commands} />
      <CommandButton id="transport.stop" label="Stop" commands={commands} />
      <span className="ag-transport-position">
        <span className="ag-panel-note" aria-hidden="true">
          Position{' '}
        </span>
        {/* A timer, whose changes a screen reader does not read out as they
            come, as a status would be every frame; it is read when reached. */}
        <span role="timer" aria-label="Position">
          {frame === undefined || rate === undefined ? '0:00.000' : positionText(frame, rate)}
        </span>
      </span>
      {view.starting && <span className="ag-panel-note">Starting…</span>}
    </div>
  );
}

/** What a finished render produced. */
function RenderSummary({ result }: { readonly result: RenderResult }): ReactNode {
  return (
    <dl className="ag-readings">
      <div className="ag-reading">
        <dt>Frames</dt>
        <dd>{`${framesText(result.frames)} at ${framesText(result.sampleRate)} Hz`}</dd>
      </div>
      <div className="ag-reading">
        <dt>Time taken</dt>
        <dd>{durationText(result.milliseconds)}</dd>
      </div>
      <div className="ag-reading">
        <dt>Processing</dt>
        <dd>
          {dspText(result.dsp)}
          {result.fallbackReason !== undefined && (
            <span className="ag-reading-note" data-ag-status="reduced">
              {result.fallbackReason}
            </span>
          )}
        </dd>
      </div>
      <div className="ag-reading">
        <dt>Fingerprint</dt>
        <dd>
          <code>{fingerprintText(result.fingerprint)}</code>
        </dd>
      </div>
    </dl>
  );
}

/** The offline render: the command, its progress, and what it produced. */
function OfflineRender({
  view,
  commands,
}: {
  readonly view: AudioView;
  readonly commands: Commands;
}): ReactNode {
  const { render } = view;
  // Said in tenths, so a screen reader hears the render move without being
  // read every chunk.
  const tenths =
    render.stage === RenderStage.Running && render.framesTotal > 0
      ? Math.floor((render.framesRendered / render.framesTotal) * 10) * 10
      : undefined;
  return (
    <div className="ag-transport-section">
      <h3 className="ag-transport-heading">Offline render</h3>
      <CommandButton
        id="transport.render-test-signal"
        label="Render the test signal offline"
        commands={commands}
      />
      {render.stage === RenderStage.Running && (
        <progress
          className="ag-render-progress"
          aria-label="Render progress"
          max={render.framesTotal}
          value={render.framesRendered}
        />
      )}
      <p role="status" className="ag-panel-note">
        {tenths === undefined ? '' : `Rendering: ${String(tenths)}%`}
      </p>
      {render.stage === RenderStage.Finished && <RenderSummary result={render.result} />}
      {render.stage === RenderStage.Failed && <PlaybackProblems problems={render.reasons} />}
    </div>
  );
}

/** The Transport panel. */
export function TransportPanel(props: TransportPanelProps): ReactNode {
  const { title, audio, capabilities, playhead } = props;
  const view = useSyncExternalStore(audio.subscribe, audio.get);
  const { chosen } = useSyncExternalStore(props.audioSettings.subscribe, props.audioSettings.get);
  const problems = [...view.problems, ...(view.playback?.problems ?? [])];
  return (
    <section className="ag-panel ag-transport">
      <h2 className="ag-panel-title">{title}</h2>
      <p className="ag-panel-note">
        {`A ${String(TEST_SIGNAL.frequency)} Hz test tone through the audio engine and its processing graph.`}
      </p>
      <TransportControls view={view} playhead={playhead} commands={props} />
      <PlaybackProblems problems={problems} />
      <LevelMeters status={view.playback} />
      <PerformanceChoice profile={chosen.profile} run={props.run} />
      <EngineState status={view.playback} />
      <OfflineRender view={view} commands={props} />
      <ProcessingModes
        settings={props.audioSettings}
        strategy={props.renderStrategy}
        run={props.run}
        unavailableReason={props.unavailableReason}
      />
      <AudioDegradations capabilities={capabilities} />
    </section>
  );
}
