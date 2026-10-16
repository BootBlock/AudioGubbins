/**
 * A shell context built entirely from fakes, for testing commands.
 *
 * Every dependency the shell takes is injected, so a command can be run against
 * a context that touches no browser: storage that lives in a map, a clock that
 * always says zero, and a capability environment that answers whatever the test
 * needs (REQ-EXEC-136.4). Nothing here reaches the real machine.
 */

import { createCapabilityRegistry, type CapabilityEnvironment } from '@audiogubbins/capabilities';
import {
  LogSeverity,
  createDiagnosticCentre,
  createLogStore,
  type LogStore,
  type Logger,
} from '@audiogubbins/diagnostics';
import {
  DockRegion,
  PanelKinds,
  type PanelDescriptor,
  type PanelKind,
} from '@audiogubbins/workspace';

import { KeyboardConvention } from '@audiogubbins/commands';
import { DetectionHost } from '@audiogubbins/detection-runtime';
import { LocalDetectionWorker } from '@audiogubbins/detection-runtime/testing';

import { DetectionControl } from '../analysis/detection-control.js';
import { LoudnessMeasuring } from '../analysis/loudness-measuring.js';
import { followGroupFocus } from '../state/group-focus.js';
import { createLoudnessStore } from '../state/loudness-store.js';
import { LoopAnalysing } from '../analysis/loop-analysing.js';
import { WorkflowAnalysing } from '../analysis/workflow-analysing.js';
import { LoopAuditioning } from '../audio/loop-audition.js';
import { createLoopAnalysisStore } from '../state/loop-analysis-store.js';
import { PlaybackControl } from '../audio/playback-control.js';
import { RenderControl } from '../audio/render-control.js';
import type { ShellContext } from '../commands/shell-context.js';
import { createAudioSettingsStore, previewQualityOf } from '../state/audio-settings-store.js';
import { createAudioViewStore } from '../state/audio-view-store.js';
import { createHearingStore } from '../state/hearing-store.js';
import { createInteractionStore, type InteractionStore } from '../state/interaction-store.js';
import { followExportFocus } from '../export/export-focus.js';
import { createLogViewStore } from '../state/log-view-store.js';
import {
  createKeyboardLayoutStore,
  type KeyboardLayoutStore,
} from '../state/keyboard-layout-store.js';
import { createPreferencesStore } from '../state/preferences-store.js';
import { createRenderStrategyStore } from '../state/render-strategy-store.js';
import { createShortcutStore } from '../state/shortcut-store.js';
import {
  createStateStorage,
  type KeyValueStorage,
  type StateStorage,
} from '../state/state-storage.js';
import { ephemeralStorage } from './ephemeral-storage.js';
import { createVerbosityStore } from '../state/verbosity-store.js';
import { createWorkspaceStore } from '../state/workspace-store.js';
import { unavailableStorageRoot } from '../state/storage-root-store.js';
import { FakePlayback, FakeRendering } from './audio-fakes.js';
import { noPackManager } from './pack-managers.js';
import { fakeEditor } from './editor-fakes.js';
import { fakeRecording, type RecordingFakes } from './recording-fakes.js';
import { recordingTextFiles, type RecordedTextFiles } from './text-files.js';
import type { PreviewPlayback } from '../audio/preview-run.js';
import { QualityLevel, namedQualityMode } from '@audiogubbins/domain';
import { createGamePreviewStore } from '../state/game-preview-store.js';
import { PreviewRunner, type GamePreviewParts } from '../audio/preview-runner.js';

/**
 * The Game preview played through `playback` on timers that never fire, for a
 * test of anything else: a run started there plays once and lays no more, and
 * no scenario asks for a render.
 */
function quietGamePreview(playback: PreviewPlayback): GamePreviewParts {
  const store = createGamePreviewStore();
  return {
    store,
    runner: new PreviewRunner(store, {
      playback,
      schedule: () => () => undefined,
      now: () => 0,
      quality: () => namedQualityMode(QualityLevel.Draft).settings,
      renders: () => {
        throw new Error('No scenario set up in this context asks for a render.');
      },
      setupOf: () => ({ ok: false, reasons: ['This test prepares no renders.'] }),
      changes: [],
    }),
  };
}

/**
 * A browser that can do everything, so nothing is degraded by accident; a test
 * of one capability missing spreads it and states that one.
 */
export const CAPABLE: CapabilityEnvironment = {
  hasOriginPrivateFileSystem: true,
  hasFileSystemAccess: true,
  hasSharedArrayBuffer: true,
  isCrossOriginIsolated: true,
  hasAudioWorklet: true,
  compilesWebAssembly: true,
  validatesWebAssemblySimd: true,
  choosesAudioOutput: true,
  hasWebWorkers: true,
  hasWebGpu: true,
  hasWebGl2: true,
  hasOffscreenCanvas: true,
  hasWebCodecs: true,
  hasMediaDevices: true,
  hasServiceWorker: true,
  hasStorageEstimate: true,
  hasPersistentStorage: true,
  hasPointerEvents: true,
  reportsPointerPressure: true,
  hasLocalStorage: true,
  hasMediaQueries: true,
  hasKeyboardLayoutMap: true,
  comparesNames: true,
  hasVideoFrameCallback: true,
  hasFullscreen: true,
};

/** `context` in a browser whose names cannot be compared. */
export function withoutNaming(context: ShellContext): ShellContext {
  return {
    ...context,
    capabilities: createCapabilityRegistry(
      { ...CAPABLE, comparesNames: false },
      createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('shell'),
    ),
  };
}

/**
 * The panels the shell has, with the regions the application gives them.
 *
 * The regions matter: a panel opened by command goes where its descriptor says,
 * so descriptors that all named the centre would make every panel land in one
 * group and hide the behaviour under test.
 */
export const DESCRIPTORS = new Map<PanelKind, PanelDescriptor>(
  (
    [
      [PanelKinds.AssetBrowser, 'Assets', DockRegion.Left],
      [PanelKinds.Editor, 'Editor', DockRegion.Centre],
      [PanelKinds.Inspector, 'Inspector', DockRegion.Right],
      [PanelKinds.Transport, 'Transport', DockRegion.Bottom],
      [PanelKinds.Diagnostics, 'Diagnostics', DockRegion.Bottom],
      [PanelKinds.Capabilities, 'Capabilities', DockRegion.Bottom],
      [PanelKinds.Picture, 'Picture', DockRegion.Right],
      [PanelKinds.Recording, 'Recorder', DockRegion.Bottom],
    ] as const
  ).map(([kind, title, defaultRegion]) => [
    kind,
    { kind, title, defaultRegion, allowsMultiple: kind === PanelKinds.Editor, closable: true },
  ]),
);

/**
 * The audio part over fakes of the runtime, which it makes nothing real with,
 * on a machine that does not say how much memory it has left.
 */
function fakeAudio(
  interaction: InteractionStore,
  storage: StateStorage,
  logger: Logger,
): {
  readonly parts: Pick<
    ShellContext,
    'audio' | 'audioSettings' | 'renderStrategy' | 'playback' | 'hearing' | 'rendering'
  >;
  readonly fakes: { readonly playback: FakePlayback; readonly rendering: FakeRendering };
} {
  const audio = createAudioViewStore();
  const audioSettings = createAudioSettingsStore(storage, logger);
  const renderStrategy = createRenderStrategyStore();
  const announce = (text: string): void => {
    interaction.announce(text);
  };
  const fakes = { playback: new FakePlayback(), rendering: new FakeRendering() };
  return {
    fakes,
    parts: {
      audio,
      audioSettings,
      renderStrategy,
      playback: new PlaybackControl({
        view: audio,
        open: fakes.playback.open,
        profile: () => audioSettings.get().chosen,
        quality: () => previewQualityOf(audioSettings.get()),
        announce,
        logger,
      }),
      hearing: createHearingStore(),
      rendering: new RenderControl({
        view: audio,
        settings: audioSettings,
        strategy: renderStrategy,
        open: fakes.rendering.open,
        resources: () => ({ availableMemoryBytes: undefined }),
        now: () => 0,
        announce,
        logger,
      }),
    },
  };
}

/**
 * The session's detections on the real worker's core, run in the test's own
 * thread, which reads the audio a test gives it as the browser's worker does.
 */
function localDetection(interaction: InteractionStore): {
  readonly control: DetectionControl;
  readonly loudness: LoudnessMeasuring;
  readonly loops: LoopAnalysing;
  readonly workers: readonly LocalDetectionWorker[];
} {
  const workers: LocalDetectionWorker[] = [];
  const host = new DetectionHost({
    createWorker: () => {
      const worker = new LocalDetectionWorker();
      workers.push(worker);
      return worker;
    },
  });
  const announce = (text: string): void => {
    interaction.announce(text);
  };
  const control = new DetectionControl({ host, announce });
  const loudness = new LoudnessMeasuring({ host, store: createLoudnessStore(), announce });
  const loops = new LoopAnalysing({ host, store: createLoopAnalysisStore(), announce });
  return { control, loudness, loops, workers };
}

/**
 * The timers a loop audition watches the feeder by, run when a test says,
 * so no test waits on the clock.
 */
export class ManualSchedule {
  readonly #due: (() => void)[] = [];

  readonly schedule = (callback: () => void): (() => void) => {
    this.#due.push(callback);
    return () => {
      const index = this.#due.indexOf(callback);
      if (index >= 0) this.#due.splice(index, 1);
    };
  };

  /** Runs every timer due now, once; those they set are due at the next call. */
  runDue(): void {
    for (const callback of this.#due.splice(0)) callback();
  }
}

/**
 * Builds a shell context, and the fakes behind it a test may want to inspect.
 *
 * Windows conventions unless the test says otherwise, so a test that asserts on
 * the written form of a shortcut says which platform it means.
 */
export function buildShellContext(
  raw: KeyValueStorage = ephemeralStorage(),
  convention: KeyboardConvention = KeyboardConvention.Windows,
  keyboardLayout?: KeyboardLayoutStore,
): {
  readonly context: ShellContext;
  readonly logs: LogStore;
  readonly files: RecordedTextFiles;
  readonly storage: StateStorage;
  /** The audio part's fakes, for a test of what the audio commands asked of them. */
  readonly audio: { readonly playback: FakePlayback; readonly rendering: FakeRendering };
  /** The detection workers the session made, in order, for a test of what it asked of them. */
  readonly detectionWorkers: readonly LocalDetectionWorker[];
  /** The recording part's fakes, for a test of the input, monitoring and the calibration. */
  readonly recording: RecordingFakes;
  /** The timers a loop audition watches the feeder by, for a test to run. */
  readonly timers: ManualSchedule;
} {
  const logs = createLogStore();
  const diagnostics = createDiagnosticCentre(
    logs,
    { now: () => 0 },
    { defaultSeverity: LogSeverity.Trace, categoryOverrides: {} },
  );
  const logger = diagnostics.loggerFor('shell');
  const files = recordingTextFiles();
  const interaction = createInteractionStore();
  const storage = createStateStorage(raw, logger, (text) => {
    interaction.announce(text, true);
  });

  // The layout store keeps what it learns through the same storage, so a test
  // that builds a second context over the same map reads it back.
  const layout =
    keyboardLayout ?? createKeyboardLayoutStore(storage, logger, KeyboardConvention.Windows);

  const { parts, fakes } = fakeAudio(interaction, storage, logger);
  const detection = localDetection(interaction);
  const timers = new ManualSchedule();
  const workspace = createWorkspaceStore(DESCRIPTORS, storage, logger);
  const recording = fakeRecording({
    settings: parts.audioSettings,
    playback: parts.playback,
    audio: parts.audio,
    workspace,
    announce: (text) => {
      interaction.announce(text);
    },
    logger,
  });

  const exportFocus = followExportFocus(workspace, recording.parts.claimed);
  return {
    logs,
    files,
    storage,
    audio: fakes,
    detectionWorkers: detection.workers,
    recording: recording.fakes,
    timers,
    context: {
      preferences: createPreferencesStore(storage, logger),
      workspace,
      interaction,
      logViews: createLogViewStore(),
      capabilities: createCapabilityRegistry(CAPABLE, logger),
      diagnostics,
      logs,
      shortcuts: createShortcutStore(convention, layout, storage, logger),
      convention,
      keyboardLayout: layout,
      files,
      verbosity: createVerbosityStore(diagnostics.verbosity(), diagnostics, storage),
      environment: { browser: 'Test browser 1', operatingSystem: 'Test system', installed: false },
      clock: { now: () => 0 },
      // A context of the shell alone keeps no projects; a test of the project
      // commands builds one that does (`project-context.ts`).
      storageRoot: unavailableStorageRoot('This test keeps no projects.'),
      projects: undefined,
      storageAbsences: [],
      exports: undefined,
      exportFocus,
      groups: followGroupFocus(workspace, recording.parts.claimed, exportFocus.subject),
      ...parts,
      ...fakeEditor(storage, logger),
      detection: detection.control,
      loudness: detection.loudness,
      loopAnalysis: detection.loops,
      workflowAnalysis: new WorkflowAnalysing([detection.control, detection.loops.analyses]),
      loopAudition: new LoopAuditioning({
        playback: parts.playback,
        audio: parts.audio,
        schedule: timers.schedule,
      }),
      packs: noPackManager(),
      recording: recording.parts,
      gamePreview: quietGamePreview(parts.playback),
    },
  };
}
