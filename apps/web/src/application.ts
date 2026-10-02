/**
 * The composition root: everything the application is built from.
 *
 * Every dependency in AudioGubbins is injected, so this is the one place that
 * knows what the real ones are: the browser's storage, the browser's clock, the
 * real capability probes. Every other module takes them as parameters, which is
 * what makes every other module testable without a browser (REQ-EXEC-136.4).
 *
 * It is also the one place that holds the stores. REQ-ARCH-153 partitions state
 * by ownership, and the partitions meet here rather than in a global store:
 * each is created once, passed to what needs it, and never reached through a
 * module import. Nothing here renders; the shell that draws the application is
 * `app.tsx`, which builds this when it mounts.
 */

import {
  createChordTracker,
  createCommandBus,
  createCommandRegistry,
  commandId,
  shortcutOffered,
  type CommandBus,
  type CommandId,
  type CommandInvocation,
  type CommandRegistry,
  type ExecutionResult,
} from '@audiogubbins/commands';
import {
  askLateQuestions,
  audioRuntimeCapabilities,
  createCapabilityRegistry,
  describeEnvironment,
  detectBrowserEnvironment,
  operatingSystemOf,
  readLayoutMap,
  readPlatformSignals,
  readResourceFigures,
  readStoragePlatform,
  watchAppearanceSettings,
  type CapabilityRegistry,
  type LayoutMapPairs,
} from '@audiogubbins/capabilities';
import { createDiagnosticCentre, createLogStore, type Logger } from '@audiogubbins/diagnostics';
import type { KeyboardConvention } from '@audiogubbins/commands';
import {
  DockRegion,
  PanelKinds,
  createDockMemory,
  panelsIn,
  type PanelDescriptor,
  type PanelKind,
} from '@audiogubbins/workspace';

import { browserEngineLoader, browserPlayback, browserRendering } from './audio/browser-audio.js';
import { PlaybackControl } from './audio/playback-control.js';
import { RenderControl } from './audio/render-control.js';
import { shellCommands } from './commands/shell-commands.js';
import type { ShellContext } from './commands/shell-context.js';
import { executeVoiced, type VoicedOptions } from './commands/voiced-execution.js';
import { dockRearrangement } from './dock-rearrangement.js';
import { browserTextFiles } from './io/text-files.js';
import { startEditor, type PanelControls } from './editor-part.js';
import { createAudioSettingsStore } from './state/audio-settings-store.js';
import { createAudioViewStore } from './state/audio-view-store.js';
import { createInteractionStore, type InteractionStore } from './state/interaction-store.js';
import { adoptLayoutMapOnReturn, browserVisibility } from './state/layout-map-watch.js';
import { startProjectSystem } from './state/project-system.js';
import { ProjectPanelKinds } from './panel-kinds.js';
import { createLogViewStore } from './state/log-view-store.js';
import {
  createKeyboardLayoutStore,
  type KeyboardLayoutStore,
} from './state/keyboard-layout-store.js';
import { createPreferencesStore } from './state/preferences-store.js';
import { createRenderStrategyStore } from './state/render-strategy-store.js';
import { createShortcutStore } from './state/shortcut-store.js';
import { browserStorage, createStateStorage, type StateStorage } from './state/state-storage.js';
import { createVerbosityStore, readStoredVerbosity } from './state/verbosity-store.js';
import { keyboardConventionFor } from './state/keyboard-convention.js';
import { createWorkspaceStore } from './state/workspace-store.js';

/**
 * What the user's keyboard layout types: known whole where the browser gives a
 * layout map, learned from the keys the user presses everywhere else, and kept
 * between visits (see `keyboard-layout-store.ts`). `layoutMap` is the map as it
 * was read, once, for the capability registry as well.
 *
 * Read again when the user comes back to the tab. A user can change layout
 * while AudioGubbins is running, and no browser offers an event for it, so the
 * moment the page is looked at again is the one occasion to ask. Read once, the
 * map would stand, and the layout would become a mixture of the old map and the
 * keys the user had typed since, so a binding could move under them.
 */
function startKeyboardLayout(
  storage: StateStorage,
  logger: Logger,
  layoutMap: Promise<LayoutMapPairs>,
  convention: KeyboardConvention,
  readAgain: () => Promise<LayoutMapPairs>,
): { readonly store: KeyboardLayoutStore; readonly stopWatching: () => void } {
  const keyboardLayout = createKeyboardLayoutStore(storage, logger, convention);

  const couldNotRead = (error: unknown): void => {
    logger.warning('The keyboard layout map could not be read.', {
      reason: error instanceof Error ? error.message : 'unknown',
    });
  };

  layoutMap.then(keyboardLayout.adopt, couldNotRead);

  // The watch is given back rather than dropped: it holds a listener on the
  // document and one on the window, and each holds this store and its storage.
  // The application lives as long as the page, so were the watch dropped,
  // nothing would leak in a browser, but every test that mounts one would leave
  // a pair behind for the next.
  const stopWatching = adoptLayoutMapOnReturn(
    keyboardLayout,
    readAgain,
    couldNotRead,
    browserVisibility(),
  );

  return { store: keyboardLayout, stopWatching };
}

/**
 * The audio part: the engine's view, the person's audio settings, how renders
 * are planned, and the controls that play and render the test signal.
 *
 * Nothing audible is made here. The context, the session, the DSP module and
 * the render host are made by the first command that needs each, from the
 * person's gesture, so a page that is only looked at starts no audio and loads
 * none of the engine's threads, and one whose browser cannot play never makes
 * a context at all: the command that would is unavailable there.
 */
function startAudio(
  capabilities: CapabilityRegistry,
  interaction: InteractionStore,
  storage: StateStorage,
  logger: Logger,
): {
  readonly parts: Pick<
    ShellContext,
    'audio' | 'audioSettings' | 'renderStrategy' | 'playback' | 'rendering'
  >;
  readonly dispose: () => void;
} {
  const runtime = audioRuntimeCapabilities(capabilities);
  const engine = browserEngineLoader(runtime);
  const audio = createAudioViewStore();
  const audioSettings = createAudioSettingsStore(storage, logger);
  const renderStrategy = createRenderStrategyStore();
  const announce = (text: string): void => {
    interaction.announce(text);
  };
  const playback = new PlaybackControl({
    view: audio,
    open: browserPlayback({ capabilities: runtime, engine, logger }),
    profile: () => audioSettings.get().chosen,
    announce,
    logger,
  });
  const rendering = new RenderControl({
    view: audio,
    settings: audioSettings,
    strategy: renderStrategy,
    open: browserRendering(engine),
    // Measured when each render is asked for, since what the page holds moves.
    resources: () => readResourceFigures(performance),
    now: () => performance.now(),
    announce,
    logger,
  });
  return {
    parts: { audio, audioSettings, renderStrategy, playback, rendering },
    dispose: () => {
      playback.dispose();
      rendering.dispose();
    },
  };
}

/**
 * How a panel's control runs a command with what it names, and asks the
 * command's label, the shortcut written beside it and why it cannot run: as
 * the menus do, so a panel's control and the menu entry are one action.
 */
function panelControls(
  context: ShellContext,
  registry: CommandRegistry<ShellContext>,
  bus: CommandBus<ShellContext>,
  run: (id: CommandId, args?: CommandInvocation['arguments']) => unknown,
  convention: KeyboardConvention,
): PanelControls {
  return {
    run: (id, args) => {
      run(commandId(id), args);
    },
    unavailableReason: (id) => {
      const availability = bus.availability(context, commandId(id));
      return availability.available ? undefined : availability.reason;
    },
    labelFor: (id) => registry.get(commandId(id))?.label ?? id,
    shortcutFor: (id) =>
      shortcutOffered(
        context.shortcuts.get().profile,
        commandId(id),
        convention,
        context.keyboardLayout.get(),
      ),
  };
}

/**
 * Which panels this build has.
 *
 * The workspace validates a stored layout against this, so a layout naming a
 * panel from a later version falls back to a preset rather than failing to
 * mount (REQ-UX-059).
 */
const PANEL_DESCRIPTORS = new Map<PanelKind, PanelDescriptor>(
  (
    [
      [PanelKinds.AssetBrowser, 'Assets', DockRegion.Left],
      [PanelKinds.Editor, 'Editor', DockRegion.Centre],
      [PanelKinds.Inspector, 'Inspector', DockRegion.Right],
      [PanelKinds.Transport, 'Transport', DockRegion.Bottom],
      [PanelKinds.Diagnostics, 'Diagnostics', DockRegion.Bottom],
      [PanelKinds.Capabilities, 'Capabilities', DockRegion.Bottom],
      [ProjectPanelKinds.History, 'History', DockRegion.Right],
      [ProjectPanelKinds.Storage, 'Storage', DockRegion.Bottom],
      [PanelKinds.Picture, 'Picture', DockRegion.Right],
    ] as const
  ).map(([kind, title, defaultRegion]) => [
    kind,
    {
      kind,
      title,
      defaultRegion,
      allowsMultiple: kind === PanelKinds.Editor,
      closable: true,
      minimumSize: { width: 200, height: 120 },
    },
  ]),
);

/**
 * Everything the application needs, built once, when it is mounted.
 *
 * Built by `mount` rather than when this module is evaluated. Built at
 * evaluation, importing the module would read storage, probe the browser and
 * write a log record, which the comment above and ADR-0011 both say does not
 * happen: the composition root would be a module-level singleton reached by
 * import, which is exactly what ADR-0011 rules out.
 */
export function createApplication() {
  const clock = { now: () => Date.now() };
  const localValues = browserStorage();

  // The stored verbosity is read before the centre that uses it exists, so the
  // first record written is already at the level the user chose. A problem
  // reading it is logged through a centre at the default level, into the same
  // store.
  const logs = createLogStore();
  const verbosity = readStoredVerbosity(
    localValues,
    createDiagnosticCentre(logs, clock).loggerFor('shell'),
  );
  const diagnostics = createDiagnosticCentre(logs, clock, verbosity);
  const logger = diagnostics.loggerFor('shell');

  // Read once, for the registry and for the keyboard layout alike: the registry
  // answers by whether the browser offered a map, and with a read of its own, a
  // browser that refused this one could be reported as giving one.
  const layoutMap = readLayoutMap(navigator);
  const capabilities = createCapabilityRegistry(
    detectBrowserEnvironment(),
    logger,
    askLateQuestions(layoutMap),
  );
  const platform = readPlatformSignals();
  const convention = keyboardConventionFor(operatingSystemOf(platform));

  // Every write goes through one object, which tells the user when their
  // changes are not being kept, in the same words spoken and shown.
  const interaction = createInteractionStore();
  const storage = createStateStorage(localValues, logger, (text) => {
    interaction.announce(text, true);
  });

  const { store: keyboardLayout, stopWatching } = startKeyboardLayout(
    storage,
    logger,
    layoutMap,
    convention,
    () => readLayoutMap(navigator),
  );

  const workspace = createWorkspaceStore(PANEL_DESCRIPTORS, storage, logger);

  // Read once, beside every other question put to the browser, and started
  // before anything else reads project storage (REQ-STOR-052).
  const projectSystem = startProjectSystem(readStoragePlatform(navigator, globalThis), {
    diagnostics,
    storage,
    page: browserVisibility(),
  });
  const logViews = createLogViewStore();

  // A log panel's filter lasts as long as the panel. A closed panel's
  // identifier is handed back to the next panel of its kind, so without this a
  // Diagnostics panel closed and opened again would come back filtered to what
  // the panel the user closed had been showing.
  workspace.subscribe(() => {
    logViews.forgetClosed(panelsIn(workspace.get().layout).map((panel) => panel.id));
  });

  const audioPart = startAudio(capabilities, interaction, storage, diagnostics.loggerFor('audio'));
  const editorPart = startEditor(
    capabilities,
    storage,
    diagnostics.loggerFor('editor'),
    workspace,
    projectSystem.peakCache,
  );

  const context: ShellContext = {
    preferences: createPreferencesStore(storage, logger),
    workspace,
    logViews,
    interaction,
    capabilities,
    diagnostics,
    logs,
    shortcuts: createShortcutStore(convention, keyboardLayout, storage, logger),
    convention,
    keyboardLayout,
    files: browserTextFiles(),
    verbosity: createVerbosityStore(verbosity, diagnostics, storage),
    environment: describeEnvironment(platform),
    clock,
    storageRoot: projectSystem.storageRoot,
    projects: projectSystem.projects,
    storageAbsences: projectSystem.storageAbsences,
    ...audioPart.parts,
    ...editorPart.parts,
  };

  const registry = createCommandRegistry<ShellContext>();
  for (const command of shellCommands(PANEL_DESCRIPTORS)) registry.register(command);

  const bus = createCommandBus(registry, diagnostics.loggerFor('commands'));
  // How every surface runs a command: through the bus, saying why when it
  // refuses. One, so the dock's reports and the shell's controls are spoken
  // of alike.
  const run = (
    id: CommandId,
    args?: CommandInvocation['arguments'],
    options?: VoicedOptions,
  ): ExecutionResult<ShellContext> =>
    executeVoiced(
      bus,
      context,
      { commandId: id, ...(args === undefined ? {} : { arguments: args }) },
      context.interaction.announce,
      options,
    );
  const rearrange = dockRearrangement(run, context.workspace.remount);
  // Read on every press rather than captured, so a binding the user just
  // changed is the one the next key press is matched against, and never a
  // binding the platform takes on the layout as it is known.
  const tracker = createChordTracker(() => context.shortcuts.get().usable);
  const editorPanels = editorPart.panelParts(
    context,
    panelControls(context, registry, bus, run, convention),
  );

  logger.info('AudioGubbins started.', {
    browser: context.environment.browser,
    operatingSystem: context.environment.operatingSystem,
  });

  return {
    context,
    registry,
    bus,
    tracker,
    logger,
    convention,
    storage,
    run,
    rearrange,
    descriptors: PANEL_DESCRIPTORS,
    appearance: watchAppearanceSettings(),
    editorPanels,
    dockMemory: createDockMemory(),

    /**
     * Stops everything the application put on the page.
     *
     * Its own function rather than React's unmounting, because what is
     * registered here is outside React: `root.unmount()` removes no
     * `visibilitychange` listener, no `focus` listener and no timer, closes
     * no audio context, ends no render and releases no project.
     */
    dispose: () => {
      stopWatching();
      audioPart.dispose();
      editorPart.dispose();
      projectSystem.dispose();
    },
  };
}

/** Everything the application needs. */
export type Application = ReturnType<typeof createApplication>;
