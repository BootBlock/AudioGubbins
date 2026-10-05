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

import { ButtonTone } from '@audiogubbins/design-system';
import type { CapabilityRegistry } from '@audiogubbins/capabilities';
import type { NodeId } from '@audiogubbins/audio-graph';
import { TransportMode } from '@audiogubbins/audio-engine';
import { sampleRate } from '@audiogubbins/domain';
import { TimeFormatKind, formatPosition } from '@audiogubbins/timeline';
import type { MeterLevels } from '@audiogubbins/audio-runtime';

import { TEST_SIGNAL } from '../audio/test-signal.js';
import type { AudioSettings } from '../state/audio-settings-store.js';
import { RenderStage, type AudioView, type RenderResult } from '../state/audio-view-store.js';
import type { Observable } from '../state/observable.js';
import type { RenderStrategyView } from '../state/render-strategy-store.js';
import { durationText, dspText, fingerprintText, framesText } from '../audio-format.js';
import {
  AudioDegradations,
  EngineState,
  LevelMeters,
  PlaybackProblems,
} from './engine-readouts.js';
import { CommandButton, type PanelCommands } from './command-button.js';
import { PerformanceChoice } from './performance-choice.js';
import { ProcessingModes } from './processing-modes.js';
import { useDisplayFrame } from './use-display-frame.js';

/** What the panel reads, and how it runs a command. */
export interface TransportPanelProps {
  readonly title: string;
  readonly audio: Observable<AudioView>;
  /** The person's audio settings: the profile, and the render mode. */
  readonly audioSettings: Observable<AudioSettings>;
  /** How the latest render was planned. */
  readonly renderStrategy: Observable<RenderStrategyView>;
  readonly capabilities: CapabilityRegistry;
  /** The frame the listener hears now, at the context's rate. */
  readonly playhead: () => number | undefined;
  /** Each meter's latest levels, the same map until the next report. */
  readonly meters: () => ReadonlyMap<NodeId, MeterLevels>;
  /** The frames the running render has reached. */
  readonly framesRendered: () => number;
  readonly run: (id: string) => void;
  /** Why a command cannot run now, or `undefined`, as the menus say it. */
  readonly unavailableReason: (id: string) => string | undefined;
  /**
   * The editor views, which Play reads: it plays the asset of the editor in
   * use, so the button is drawn again as that changes.
   */
  readonly editorViews: Observable<unknown>;
}

/** A transport position as the editor writes a clock, or the start where nothing plays. */
function positionOf(frame: number | undefined, rate: number | undefined): string {
  const read = rate === undefined ? undefined : sampleRate(rate);
  return frame === undefined || read?.ok !== true
    ? '0:00.000'
    : formatPosition(frame, read.value, { kind: TimeFormatKind.Clock });
}

/** Play, Pause and Stop, and where playback is. */
function TransportControls({
  view,
  playhead,
  commands,
}: {
  readonly view: AudioView;
  readonly playhead: () => number | undefined;
  readonly commands: PanelCommands;
}): ReactNode {
  const mode = view.playback?.transport.mode;
  const frame = useDisplayFrame(playhead, mode === TransportMode.Playing);
  const rate = view.playback?.device?.sampleRate;
  return (
    <div className="ag-transport-controls" role="group" aria-label="Transport">
      <CommandButton
        id="transport.play"
        label="Play"
        tone={ButtonTone.Primary}
        commands={commands}
      />
      <CommandButton
        id="transport.play-test-signal"
        label="Play the test signal"
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
          {positionOf(frame, rate)}
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
  framesRendered,
  commands,
}: {
  readonly view: AudioView;
  readonly framesRendered: () => number;
  readonly commands: PanelCommands;
}): ReactNode {
  const { render } = view;
  const rendered = useDisplayFrame(framesRendered, render.stage === RenderStage.Running);
  // Said in tenths, so a screen reader hears the render move without being
  // read every chunk.
  const tenths =
    render.stage === RenderStage.Running && render.framesTotal > 0
      ? Math.floor((rendered / render.framesTotal) * 10) * 10
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
          value={rendered}
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

/** The levels, read once a display frame while playback moves, as the position is. */
function Levels({
  view,
  meters,
}: {
  readonly view: AudioView;
  readonly meters: () => ReadonlyMap<NodeId, MeterLevels>;
}): ReactNode {
  const levels = useDisplayFrame(meters, view.playback?.transport.mode === TransportMode.Playing);
  return <LevelMeters meters={levels} />;
}

/** The Transport panel. */
export function TransportPanel(props: TransportPanelProps): ReactNode {
  const { title, audio, capabilities, playhead, meters } = props;
  const view = useSyncExternalStore(audio.subscribe, audio.get);
  useSyncExternalStore(props.editorViews.subscribe, props.editorViews.get);
  const { chosen } = useSyncExternalStore(props.audioSettings.subscribe, props.audioSettings.get);
  const problems = [...view.problems, ...(view.playback?.problems ?? [])];
  return (
    <section className="ag-panel ag-transport">
      <h2 className="ag-panel-title">{title}</h2>
      <p className="ag-panel-note">
        {`Play plays the asset in the editor in use, at its own rate. The test signal is a ${String(TEST_SIGNAL.frequency)} Hz tone through the audio engine and its processing graph.`}
      </p>
      <TransportControls view={view} playhead={playhead} commands={props} />
      <PlaybackProblems problems={problems} />
      <Levels view={view} meters={meters} />
      <PerformanceChoice profile={chosen.profile} run={props.run} />
      <EngineState status={view.playback} />
      <OfflineRender view={view} framesRendered={props.framesRendered} commands={props} />
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
