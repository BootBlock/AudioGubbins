/**
 * The composition root's editor part: the assets of the session, their
 * content, selections and playheads, the views of them, the peaks every view
 * shares, the graphics the views draw with, and the reference picture.
 *
 * Its own module beside `application.ts`, which builds it, because it is a
 * part of the root with its own real collaborators, as the audio part's are
 * the browser's audio. Nothing heavy is started here: the peak worker is made
 * when a view first asks for peaks, the spectrogram worker when one first
 * shows a spectrogram, and a renderer when a view is first drawn.
 */

import {
  CapabilityKey,
  readGraphicsPlatform,
  readResourceFigures,
  type CapabilityRegistry,
} from '@audiogubbins/capabilities';
import type { Logger } from '@audiogubbins/diagnostics';
import { createIdGenerator } from '@audiogubbins/domain';
import { DEFAULT_GESTURE_SETTINGS } from '@audiogubbins/input';
import { TransportMode } from '@audiogubbins/audio-engine';
import type { PreviewHost } from '@audiogubbins/audio-runtime';
import {
  SpectrogramHost,
  type SpectralTileCache,
  type SpectrogramHostEvent,
} from '@audiogubbins/spectral-analysis';
import { PeakHost, type PeakCacheStore, type PeakEvent } from '@audiogubbins/waveform';
import { PanelKinds, activePanelOf, panelsIn } from '@audiogubbins/workspace';

import { testAssets } from './assets/test-assets.js';
import { playheadOf } from './commands/editor-target.js';
import type { ShellContext } from './commands/shell-context.js';
import type { EditorPanelParts } from './editor/panel-parts.js';
import type { PageDsp } from './audio/page-dsp.js';
import { browserPeakWorker } from './editor/peak-threads.js';
import { browserSpectrogramWorker } from './editor/spectrogram-threads.js';
import type { ModelServices } from './ml/model-services.js';
import { modelGates } from './ml/model-words.js';
import { holdShownPeaks } from './editor/shown-peaks.js';
import { browserPicturePlatform, browserSoundDecoder } from './picture/browser-picture.js';
import { PictureSoundDecoder } from './picture/picture-sound.js';
import { ReferencePicture } from './picture/reference-picture.js';
import { createAssetCatalogue, type AssetCatalogue } from './state/asset-catalogue.js';
import { followProjectAssets } from './state/project-catalogue.js';
import type { ProjectStores } from './state/project-stores.js';
import { createChosenFiles } from './state/chosen-files.js';
import { createClipboardStore } from './state/clipboard-store.js';
import { createCueStore } from './state/cue-store.js';
import { createEditorViewStore, type EditorViewStore } from './state/editor-view-store.js';
import { createRendererReports } from './state/renderer-reports.js';
import { reconcileSelections } from './state/selection-reconciling.js';
import { createSelectionStore } from './state/selection-store.js';
import type { AudioSettings } from './state/audio-settings-store.js';
import type { Observable } from './state/observable.js';
import type { StateStorage } from './state/state-storage.js';
import type { WorkspaceStore } from './state/workspace-store.js';

/** What a peak event is recorded as, for the diagnostic log. */
const PEAK_EVENT_MESSAGES: Readonly<Record<PeakEvent['kind'], string>> = {
  'cache-refused': 'Kept waveform peaks were refused and are being made again.',
  'cache-unreadable': 'The waveform cache could not be read, so peaks are being made again.',
  'cache-unwritten': 'Waveform peaks could not be kept for the next visit.',
  failed: 'Waveform peaks could not be made.',
};

/** What a spectrogram event is recorded as, for the diagnostic log. */
const SPECTROGRAM_EVENT_MESSAGES: Readonly<Record<SpectrogramHostEvent['kind'], string>> = {
  'cache-refused': 'A kept spectrogram tile was refused and is being made again.',
  'cache-unreadable': 'The spectrogram cache could not be read, so tiles are being made again.',
  'cache-unwritten':
    'A spectrogram tile could not be kept for the next visit; it is kept until the page closes.',
  failed: 'A spectrogram could not be made.',
  dsp: 'The spectrogram worker runs its DSP.',
};

/**
 * Makes the editor a command acts on, when it names none, the one last in use,
 * and forgets the view of an editor panel once it is closed.
 */
function followWorkspace(workspace: WorkspaceStore, editorViews: EditorViewStore): void {
  const follow = (): void => {
    const { layout } = workspace.get();
    const active = activePanelOf(layout);
    if (active?.kind === PanelKinds.Editor) editorViews.focus(active.id);
    editorViews.forgetClosed(
      panelsIn(layout)
        .filter((panel) => panel.kind === PanelKinds.Editor)
        .map((panel) => panel.id),
    );
  };
  follow();
  workspace.subscribe(follow);
}

/**
 * The one peak host, its peaks kept in `cache`, its racked sounds read from
 * `previews`, its worker connected to the models a chain runs by `models`.
 */
function peakHost(
  cache: PeakCacheStore,
  logger: Logger,
  previews: PreviewHost,
  models: ModelServices,
): PeakHost {
  return new PeakHost({
    createWorker: () => browserPeakWorker(previews, models),
    cache,
    report: (event) => {
      const fields = { reason: event.reason };
      if (event.kind === 'failed') logger.error(PEAK_EVENT_MESSAGES[event.kind], fields);
      else logger.warning(PEAK_EVENT_MESSAGES[event.kind], fields);
    },
  });
}

/**
 * The one spectrogram host, its tiles kept in `cache`, its worker running the
 * page's DSP, its racked sounds read from `previews` and its chains' models
 * run by `models` (ADR-0080).
 */
function spectrogramHost(
  cache: SpectralTileCache,
  logger: Logger,
  previews: PreviewHost,
  models: ModelServices,
  dsp: PageDsp,
): SpectrogramHost {
  return new SpectrogramHost({
    createWorker: () => browserSpectrogramWorker(previews, models, dsp),
    cache,
    report: (event) => {
      const message = SPECTROGRAM_EVENT_MESSAGES[event.kind];
      if (event.kind === 'dsp') {
        logger.info(message, {
          kind: event.implementation,
          ...(event.fallbackReason === undefined ? {} : { reason: event.fallbackReason }),
        });
      } else if (event.kind === 'failed') {
        logger.error(message, { reason: event.reason });
      } else {
        logger.warning(message, { reason: event.reason });
      }
    },
    now: () => Date.now(),
  });
}

/** How a panel's control runs a command, and asks its label, shortcut and reason. */
export type PanelControls = Pick<
  EditorPanelParts,
  'run' | 'unavailableReason' | 'labelFor' | 'shortcutFor'
>;

/**
 * The panels' parts, made once: a panel's surface is mounted for the parts it
 * is given, so a new object each render would mount it again each render.
 */
export function panelPartsOf(
  context: ShellContext,
  controls: PanelControls,
  services: Pick<
    EditorPanelParts,
    'peaks' | 'spectrograms' | 'graphics' | 'rendererReports' | 'logger'
  >,
): EditorPanelParts {
  return {
    ...controls,
    ...services,
    announce: (text) => {
      context.interaction.announce(text, false, { shown: false });
    },
    stores: {
      editorViews: context.editorViews,
      selections: context.selections,
      cues: context.cues,
      assets: context.assets,
      picture: context.picture,
      audio: context.audio,
      audioSettings: context.audioSettings,
      playhead: (asset) => playheadOf(context, asset),
      playing: (asset) =>
        context.playback.programme() === asset &&
        context.audio.get().playback?.transport.mode === TransportMode.Playing,
      gestures: () => ({ ...DEFAULT_GESTURE_SETTINGS, ...context.preferences.get().pressure }),
    },
    assets: context.assets,
    picture: context.picture,
    chosenFiles: context.chosenFiles,
  };
}

/** The reference picture, and what extracts its sound as an asset of `assets`. */
function referencePicture(
  capabilities: CapabilityRegistry,
  assets: AssetCatalogue,
  logger: Logger,
): { readonly picture: ReferencePicture; readonly pictureSound: PictureSoundDecoder } {
  const picture = new ReferencePicture({
    platform: browserPicturePlatform(capabilities.has(CapabilityKey.VideoFrameCallback)),
    logger,
  });
  const pictureSound = new PictureSoundDecoder({
    decode: browserSoundDecoder(),
    picture,
    catalogue: assets,
    logger,
    // Measured when each extraction is weighed, since what the page holds moves.
    resources: () => readResourceFigures(performance),
  });
  return { picture, pictureSound };
}

/**
 * Builds the editor part, its assets following the open project of `projects`
 * where this browser keeps projects, and its peaks drawn at the chosen render
 * quality of `audioSettings`, a racked sound's from the renders of `previews`.
 */
export function startEditor(
  capabilities: CapabilityRegistry,
  storage: StateStorage,
  logger: Logger,
  workspace: WorkspaceStore,
  audioSettings: Observable<Pick<AudioSettings, 'renderQuality'>>,
  projects: {
    readonly projects: ProjectStores | undefined;
    readonly peakCache: PeakCacheStore;
    readonly spectrogramCache: SpectralTileCache;
  },
  previews: PreviewHost,
  models: ModelServices,
  dsp: PageDsp,
) {
  const assets = createAssetCatalogue(testAssets(), logger);
  const modelGate = modelGates(models.availability);
  const stopFollowing =
    projects.projects === undefined
      ? undefined
      : followProjectAssets(projects.projects, assets, modelGate);
  const selections = createSelectionStore();
  reconcileSelections(selections, assets);
  const editorViews = createEditorViewStore(storage, logger, (write) => {
    setTimeout(write, 250);
  });
  followWorkspace(workspace, editorViews);
  // A page that closes or reloads is hidden first, which is the last moment a
  // view's waiting write can be made.
  const flushViews = (): void => {
    if (document.visibilityState === 'hidden') editorViews.flush();
  };
  document.addEventListener('visibilitychange', flushViews);
  const { picture, pictureSound } = referencePicture(capabilities, assets, logger);
  const peaks = peakHost(projects.peakCache, logger, previews, models);
  const letShownPeaksGo = holdShownPeaks(editorViews, assets, audioSettings, peaks);
  const spectrograms = spectrogramHost(projects.spectrogramCache, logger, previews, models, dsp);
  const graphics = readGraphicsPlatform();
  const rendererReports = createRendererReports();
  return {
    parts: {
      assets,
      selections,
      cues: createCueStore(),
      editorViews,
      ids: createIdGenerator((length) => crypto.getRandomValues(new Uint8Array(length))),
      picture,
      pictureSound,
      chosenFiles: createChosenFiles(),
      clipboard: createClipboardStore(),
      modelGate,
    },
    /** What the Editor and Picture panels are given, once the controls exist. */
    panelParts: (context: ShellContext, controls: PanelControls): EditorPanelParts =>
      panelPartsOf(context, controls, { peaks, spectrograms, graphics, rendererReports, logger }),
    dispose: () => {
      stopFollowing?.();
      document.removeEventListener('visibilitychange', flushViews);
      editorViews.flush();
      letShownPeaksGo();
      peaks.dispose();
      spectrograms.dispose();
      picture.dispose();
    },
  };
}
