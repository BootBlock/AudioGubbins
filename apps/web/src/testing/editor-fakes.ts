/**
 * The editor part over fakes, for testing the editor's commands and panels:
 * the real test assets and stores, deterministic identities, and a reference
 * picture over a video element that loads, plays and decodes nothing, since
 * jsdom does none of it. A test moves the fake element's state itself.
 */

import { createDeterministicIdGenerator } from '@audiogubbins/domain';
import type { Logger } from '@audiogubbins/diagnostics';

import { PeakHost, type PeakWorkerPort } from '@audiogubbins/waveform';

import { testAssets } from '../assets/test-assets.js';
import { panelPartsOf } from '../editor-part.js';
import type { EditorPanelParts } from '../editor/panel-parts.js';
import { NO_PEAK_CACHE } from '../io/peak-cache-store.js';
import { createRendererReports } from '../state/renderer-reports.js';
import type { ShellContext } from '../commands/shell-context.js';
import { PictureSoundDecoder, type DecodedSound } from '../picture/picture-sound.js';
import { ReferencePicture, type PicturePlatform } from '../picture/reference-picture.js';
import { createAssetCatalogue } from '../state/asset-catalogue.js';
import { createChosenFiles } from '../state/chosen-files.js';
import { createCueStore } from '../state/cue-store.js';
import { createEditorViewStore } from '../state/editor-view-store.js';
import { reconcileSelections } from '../state/selection-reconciling.js';
import { createSelectionStore } from '../state/selection-store.js';
import { createSessionContent } from '../state/session-content.js';
import type { StateStorage } from '../state/state-storage.js';

/** A video element that loads nothing, and plays and seeks only by what it is told. */
function fakeVideo(): HTMLVideoElement {
  const element = document.createElement('video');
  let paused = true;
  let currentTime = 0;
  return Object.defineProperties(element, {
    load: { value: () => undefined },
    play: {
      value: () => {
        paused = false;
        return Promise.resolve();
      },
    },
    pause: {
      value: () => {
        paused = true;
      },
    },
    paused: { get: () => paused },
    // Ten seconds of 320 by 180, as a test's picture has once it has loaded.
    duration: { get: () => 10 },
    videoWidth: { get: () => 320 },
    videoHeight: { get: () => 180 },
    currentTime: {
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value;
      },
    },
  });
}

/** The picture's platform over a fake element, which the test can reach. */
function fakePicturePlatform(): PicturePlatform & { readonly videos: HTMLVideoElement[] } {
  const videos: HTMLVideoElement[] = [];
  return {
    videos,
    createVideo: () => {
      const video = fakeVideo();
      videos.push(video);
      return video;
    },
    createUrl: () => 'blob:picture',
    revokeUrl: () => undefined,
    capture: () => Promise.resolve(document.createElement('canvas')),
    framesAnnounced: false,
  };
}

/** The editor part of a shell context, over the real stores and a fake picture. */
export function fakeEditor(
  storage: StateStorage,
  logger: Logger,
  decode: (bytes: ArrayBuffer) => Promise<DecodedSound | string> = () =>
    Promise.resolve('This test decodes no sound.'),
): Pick<
  ShellContext,
  | 'assets'
  | 'content'
  | 'selections'
  | 'cues'
  | 'editorViews'
  | 'ids'
  | 'picture'
  | 'pictureSound'
  | 'chosenFiles'
> {
  const assets = createAssetCatalogue(testAssets(), logger);
  const picture = new ReferencePicture({ platform: fakePicturePlatform(), logger });
  const content = createSessionContent();
  const selections = createSelectionStore();
  reconcileSelections(content, selections, assets);
  return {
    assets,
    content,
    selections,
    cues: createCueStore(),
    // Written at once, so a test reads back what a view keeps without waiting.
    editorViews: createEditorViewStore(storage, logger, (write) => {
      write();
    }),
    ids: createDeterministicIdGenerator(4),
    picture,
    pictureSound: new PictureSoundDecoder({ decode, picture, catalogue: assets, logger }),
    chosenFiles: createChosenFiles(),
  };
}

/** A peak worker that takes every message and answers none, for a panel that is only drawn. */
function silentPeakWorker(): PeakWorkerPort {
  return { post: () => undefined, listen: () => undefined, terminate: () => undefined };
}

/** The Editor and Picture panels' parts over `context`, drawing nothing and asking no worker. */
export function fakePanelParts(context: ShellContext, logger: Logger): EditorPanelParts {
  return panelPartsOf(
    context,
    {
      run: () => undefined,
      unavailableReason: () => undefined,
      labelFor: (id) => id,
      shortcutFor: () => undefined,
    },
    {
      peaks: new PeakHost({
        createWorker: silentPeakWorker,
        cache: NO_PEAK_CACHE,
        report: () => undefined,
      }),
      graphics: { gpu: undefined, pixelRatio: () => 1, watchPixelRatio: () => () => undefined },
      rendererReports: createRendererReports(),
      logger,
    },
  );
}
