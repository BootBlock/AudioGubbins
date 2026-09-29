/**
 * The composition root's editor part: the assets of the session, their
 * content, selections and playheads, the views of them, the peaks every view
 * shares, the graphics the views draw with, and the reference picture.
 *
 * Its own module beside `application.ts`, which builds it, because it is a
 * part of the root with its own real collaborators, as the audio part's are
 * the browser's audio. Nothing heavy is started here: the peak worker is made
 * when a view first asks for peaks, and a renderer when a view is first drawn.
 */

import {
  CapabilityKey,
  readGraphicsPlatform,
  readResourceFigures,
  type CapabilityRegistry,
} from '@audiogubbins/capabilities';
import type { Logger } from '@audiogubbins/diagnostics';
import { createIdGenerator } from '@audiogubbins/domain';
import { TransportMode } from '@audiogubbins/audio-engine';
import { PeakHost, type PeakEvent } from '@audiogubbins/waveform';
import { PanelKinds, activePanelOf, panelsIn } from '@audiogubbins/workspace';

import { testAssets } from './assets/test-assets.js';
import { playheadOf } from './commands/editor-target.js';
import type { ShellContext } from './commands/shell-context.js';
import type { EditorPanelParts } from './editor/panel-parts.js';
import { browserPeakWorker } from './editor/peak-threads.js';
import { NO_PEAK_CACHE, indexedDbPeakCache } from './io/peak-cache-store.js';
import { browserPicturePlatform, browserSoundDecoder } from './picture/browser-picture.js';
import { PictureSoundDecoder } from './picture/picture-sound.js';
import { ReferencePicture } from './picture/reference-picture.js';
import { createAssetCatalogue } from './state/asset-catalogue.js';
import { createChosenFiles } from './state/chosen-files.js';
import { createCueStore } from './state/cue-store.js';
import { createEditorViewStore, type EditorViewStore } from './state/editor-view-store.js';
import { createRendererReports } from './state/renderer-reports.js';
import { reconcileSelections } from './state/selection-reconciling.js';
import { createSelectionStore } from './state/selection-store.js';
import { createSessionContent } from './state/session-content.js';
import type { StateStorage } from './state/state-storage.js';
import type { WorkspaceStore } from './state/workspace-store.js';

/** What a peak event is recorded as, for the diagnostic log. */
const PEAK_EVENT_MESSAGES: Readonly<Record<PeakEvent['kind'], string>> = {
  'cache-refused': 'Kept waveform peaks were refused and are being made again.',
  'cache-unreadable': 'The waveform cache could not be read, so peaks are being made again.',
  'cache-unwritten': 'Waveform peaks could not be kept for the next visit.',
  failed: 'Waveform peaks could not be made.',
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

/** The one peak host, its peaks kept where the browser has somewhere to keep them. */
function peakHost(capabilities: CapabilityRegistry, logger: Logger): PeakHost {
  return new PeakHost({
    createWorker: browserPeakWorker,
    cache: capabilities.has(CapabilityKey.IndexedDb)
      ? indexedDbPeakCache(indexedDB)
      : NO_PEAK_CACHE,
    report: (event) => {
      const fields = { reason: event.reason };
      if (event.kind === 'failed') logger.error(PEAK_EVENT_MESSAGES[event.kind], fields);
      else logger.warning(PEAK_EVENT_MESSAGES[event.kind], fields);
    },
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
  services: Pick<EditorPanelParts, 'peaks' | 'graphics' | 'rendererReports' | 'logger'>,
): EditorPanelParts {
  return {
    ...controls,
    ...services,
    stores: {
      editorViews: context.editorViews,
      selections: context.selections,
      content: context.content,
      cues: context.cues,
      assets: context.assets,
      picture: context.picture,
      audio: context.audio,
      playhead: (asset) => playheadOf(context, asset),
      playing: (asset) =>
        context.playback.programme() === asset &&
        context.audio.get().playback?.transport.mode === TransportMode.Playing,
    },
    assets: context.assets,
    picture: context.picture,
    chosenFiles: context.chosenFiles,
  };
}

/** Builds the editor part. */
export function startEditor(
  capabilities: CapabilityRegistry,
  storage: StateStorage,
  logger: Logger,
  workspace: WorkspaceStore,
) {
  const assets = createAssetCatalogue(testAssets(), logger);
  const content = createSessionContent();
  const selections = createSelectionStore();
  reconcileSelections(content, selections, assets);
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
  const picture = new ReferencePicture({
    platform: browserPicturePlatform(capabilities.has(CapabilityKey.VideoFrameCallback)),
    logger,
  });
  const peaks = peakHost(capabilities, logger);
  const graphics = readGraphicsPlatform();
  const rendererReports = createRendererReports();
  return {
    parts: {
      assets,
      content,
      selections,
      cues: createCueStore(),
      editorViews,
      ids: createIdGenerator((length) => crypto.getRandomValues(new Uint8Array(length))),
      picture,
      pictureSound: new PictureSoundDecoder({
        decode: browserSoundDecoder(),
        picture,
        catalogue: assets,
        logger,
        // Measured when each extraction is weighed, since what the page holds moves.
        resources: () => readResourceFigures(performance),
      }),
      chosenFiles: createChosenFiles(),
    },
    /** What the Editor and Picture panels are given, once the controls exist. */
    panelParts: (context: ShellContext, controls: PanelControls): EditorPanelParts =>
      panelPartsOf(context, controls, { peaks, graphics, rendererReports, logger }),
    dispose: () => {
      document.removeEventListener('visibilitychange', flushViews);
      editorViews.flush();
      peaks.dispose();
      picture.dispose();
    },
  };
}
