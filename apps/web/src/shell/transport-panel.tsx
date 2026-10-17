/**
 * The Transport panel: the test signal played through the engine and its
 * graph, rendered offline, and everything the engine reports while it does.
 *
 * Every control runs a command, so a button here and the palette entry of
 * the same name are one action with one reason when it cannot run
 * (REQ-EDIT-073); the panel reads the engine's view and changes nothing
 * itself. A control whose feature this browser lacks stays on screen,
 * unavailable, with the reason beside it (WU-03.E).
 *
 * The engine's readings and the offline render sit in closed sections, as
 * advanced settings do (REQ-UX-071); what a render is doing and why it
 * failed is said outside its section, so it is seen and heard either way.
 */

import { useSyncExternalStore, type ReactNode } from 'react';

import { ButtonTone, Hint, ProgressBar, Section } from '@audiogubbins/design-system';
import type { CapabilityRegistry } from '@audiogubbins/capabilities';
import type { NodeId } from '@audiogubbins/audio-graph';
import { TransportMode, type PerformanceProfile } from '@audiogubbins/audio-engine';
import { sampleRate } from '@audiogubbins/domain';
import { TimeFormatKind, formatPosition } from '@audiogubbins/timeline';
import type { MeterLevels } from '@audiogubbins/audio-runtime';

import { TEST_SIGNAL } from '../audio/test-signal.js';
import type { AudioSettings } from '../state/audio-settings-store.js';
import { RenderStage, type AudioView, type RenderResult } from '../state/audio-view-store.js';
import type { Observable } from '../state/observable.js';
import type { RenderStrategyView } from '../state/render-strategy-store.js';
import { durationText, dspText, fingerprintText, framesText } from '../audio-format.js';
import { sampleRateWords } from '../wording.js';
import {
  AudioDegradations,
  EngineState,
  LevelMeters,
  PlaybackProblems,
  engineSummary,
} from './engine-readouts.js';
import { CommandButton, type PanelCommands } from './command-button.js';
import { PerformanceChoice } from './performance-choice.js';
import { HearingSwitch } from './rack/hearing-switch.js';
import { PlaybackModes } from './playback-modes.js';
import { RenderModes, RenderWarnings } from './processing-modes.js';
import type { Hearing } from '../state/hearing-store.js';
import { useDisplayFrame } from './use-display-frame.js';

/** What the panel reads, and how it runs a command. */
export interface TransportPanelProps {
  readonly title: string;
  /**
   * The assets an editor view can open, whose opening makes Play available:
   * an asset whose files are still being read opens later, and Play is
   * offered once it has.
   */
  readonly assets: Observable<unknown>;
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
  /** Whether the asset is heard processed or as its original, which the panel says and switches. */
  readonly hearing: Observable<Hearing>;
}

/** A transport position as the editor writes a clock, or the start where nothing plays. */
function positionOf(frame: number | undefined, rate: number | undefined): string {
  const read = rate === undefined ? undefined : sampleRate(rate);
  return frame === undefined || read?.ok !== true
    ? '0:00.000'
    : formatPosition(frame, read.value, { kind: TimeFormatKind.Clock });
}

/**
 * The transport's buttons, in the order they stand: each command and its
 * name, drawn as its command's glyph.
 */
const TRANSPORT_BUTTONS: readonly {
  readonly id: string;
  readonly label: string;
  readonly tone?: ButtonTone;
}[] = [
  { id: 'transport.stop', label: 'Stop' },
  { id: 'transport.play', label: 'Play', tone: ButtonTone.Primary },
  { id: 'transport.pause', label: 'Pause' },
  { id: 'transport.play-test-signal', label: 'Play the test signal' },
];

/** What the readout says under the position: whether the context is starting, and its rate. */
function playbackState(view: AudioView): string {
  const rate = view.playback?.device?.sampleRate;
  return [
    ...(view.starting ? ['Starting…'] : []),
    ...(rate === undefined ? [] : [sampleRateWords(rate)]),
  ].join(' · ');
}

/**
 * Stop, Play, Pause and the test signal, the position in its readout with the
 * state of playback under it, and hearing the original beside them.
 */
function TransportControls({
  view,
  playhead,
  commands,
  hearing,
}: {
  readonly view: AudioView;
  readonly playhead: () => number | undefined;
  readonly commands: PanelCommands;
  readonly hearing: Observable<Hearing>;
}): ReactNode {
  const mode = view.playback?.transport.mode;
  const frame = useDisplayFrame(playhead, mode === TransportMode.Playing);
  const rate = view.playback?.device?.sampleRate;
  return (
    <div className="ag-transport-main">
      <div className="ag-transport-controls" role="group" aria-label="Transport">
        {TRANSPORT_BUTTONS.map(({ id, label, tone }) => (
          <CommandButton
            key={id}
            id={id}
            label={label}
            commands={commands}
            tone={tone ?? ButtonTone.Neutral}
            iconOnly
          />
        ))}
        <div className="ag-transport-readout">
          {/* A timer, whose changes a screen reader does not read out as they
            come, as a status would be every frame; it is read when reached. */}
          <span className="ag-transport-time" role="timer" aria-label="Position">
            {positionOf(frame, rate)}
          </span>
          <span className="ag-transport-state">{playbackState(view)}</span>
        </div>
      </div>
      <HearingSwitch hearing={hearing} commands={commands} />
      <span className="ag-transport-about">
        <Hint label="About the transport">
          {`Play plays the asset in the editor in use, at its own rate. The test signal is a ${String(TEST_SIGNAL.frequency)} Hz tone through the audio engine.`}
        </Hint>
      </span>
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

/**
 * The offline render: the command and what it produced, in a closed section,
 * and its progress and failure under it, so a render the palette started is
 * seen and heard whether the section is open or not.
 */
function OfflineRender({
  view,
  framesRendered,
  commands,
  modes,
}: {
  readonly view: AudioView;
  readonly framesRendered: () => number;
  readonly commands: PanelCommands;
  /** How the render runs: its mode, the render mode set and the quality. */
  readonly modes: ReactNode;
}): ReactNode {
  const { render } = view;
  const running = render.stage === RenderStage.Running;
  const rendered = useDisplayFrame(framesRendered, running);
  const share = running && render.framesTotal > 0 ? rendered / render.framesTotal : undefined;
  // Said in tenths, so a screen reader hears the render move without being
  // read every chunk.
  const tenths = share === undefined ? undefined : Math.floor(share * 10) * 10;
  return (
    <>
      <Section title="Offline render" defaultOpen={false}>
        <div className="ag-transport-render">
          {modes}
          <CommandButton
            id="transport.render-test-signal"
            label="Render the test signal offline"
            commands={commands}
          />
          {render.stage === RenderStage.Finished && <RenderSummary result={render.result} />}
        </div>
      </Section>
      {running && <ProgressBar label="Render progress" value={share ?? null} />}
      <p role="status" className="ag-panel-note">
        {tenths === undefined ? '' : `Rendering: ${String(tenths)}%`}
      </p>
      {render.stage === RenderStage.Failed && <PlaybackProblems problems={render.reasons} />}
    </>
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

/**
 * The panel's settings column: the profile, how playback runs, and the closed
 * Engine and Offline render sections, with what a render was warned of after
 * them.
 */
function TransportSide({
  view,
  profile,
  ...props
}: TransportPanelProps & {
  readonly view: AudioView;
  readonly profile: PerformanceProfile;
}): ReactNode {
  return (
    <div className="ag-transport-side">
      <PerformanceChoice profile={profile} run={props.run} />
      <PlaybackModes audio={props.audio} settings={props.audioSettings} />
      <Section title="Engine" summary={engineSummary(view.playback)} defaultOpen={false}>
        <EngineState status={view.playback} />
      </Section>
      <OfflineRender
        view={view}
        framesRendered={props.framesRendered}
        commands={props}
        modes={
          <RenderModes
            settings={props.audioSettings}
            strategy={props.renderStrategy}
            run={props.run}
          />
        }
      />
      <RenderWarnings
        strategy={props.renderStrategy}
        run={props.run}
        unavailableReason={props.unavailableReason}
      />
    </div>
  );
}

/** The Transport panel. */
export function TransportPanel(props: TransportPanelProps): ReactNode {
  const { title, audio, capabilities, playhead, meters } = props;
  const view = useSyncExternalStore(audio.subscribe, audio.get);
  useSyncExternalStore(props.editorViews.subscribe, props.editorViews.get);
  useSyncExternalStore(props.assets.subscribe, props.assets.get);
  const { chosen } = useSyncExternalStore(props.audioSettings.subscribe, props.audioSettings.get);
  const problems = [...view.problems, ...(view.playback?.problems ?? [])];
  return (
    <section className="ag-panel ag-transport">
      {/* Named for a screen reader: the dock's tab shows the title. */}
      <h2 className="ag-visually-hidden">{title}</h2>
      <div className="ag-transport-body">
        <TransportControls
          view={view}
          playhead={playhead}
          commands={props}
          hearing={props.hearing}
        />
        <PlaybackProblems problems={problems} />
        <div className="ag-transport-levels">
          <Levels view={view} meters={meters} />
        </div>
        <TransportSide view={view} profile={chosen.profile} {...props} />
        <AudioDegradations capabilities={capabilities} />
      </div>
    </section>
  );
}
