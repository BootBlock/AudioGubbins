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

import { PlaybackControl } from '../audio/playback-control.js';
import { RenderControl } from '../audio/render-control.js';
import type { ShellContext } from '../commands/shell-context.js';
import { createAudioSettingsStore } from '../state/audio-settings-store.js';
import { createAudioViewStore } from '../state/audio-view-store.js';
import { createInteractionStore, type InteractionStore } from '../state/interaction-store.js';
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
import { FakePlayback, FakeRendering } from './audio-fakes.js';
import { fakeEditor } from './editor-fakes.js';
import { recordingTextFiles, type RecordedTextFiles } from './text-files.js';

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
  hasIndexedDb: true,
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
    'audio' | 'audioSettings' | 'renderStrategy' | 'playback' | 'rendering'
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
        announce,
        logger,
      }),
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

  return {
    logs,
    files,
    storage,
    audio: fakes,
    context: {
      preferences: createPreferencesStore(storage, logger),
      workspace: createWorkspaceStore(DESCRIPTORS, storage, logger),
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
      ...parts,
      ...fakeEditor(storage, logger),
    },
  };
}
