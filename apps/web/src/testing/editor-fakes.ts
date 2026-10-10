/**
 * The editor part over fakes, for testing the editor's commands and panels:
 * the real test assets and stores, deterministic identities, and a reference
 * picture over a video element that loads, plays and decodes nothing, since
 * jsdom does none of it. A test moves the fake element's state itself.
 */

import { createDeterministicIdGenerator } from '@audiogubbins/domain';
import type { Logger } from '@audiogubbins/diagnostics';

import { SpectrogramHost, type SpectrogramWorkerPort } from '@audiogubbins/spectral-analysis';
import { PeakHost, type PeakWorkerPort } from '@audiogubbins/waveform';

import { testAssets } from '../assets/test-assets.js';
import { panelPartsOf } from '../editor-part.js';
import type { EditorPanelParts } from '../editor/panel-parts.js';
import { NO_PEAK_CACHE } from '../io/stored-peak-cache.js';
import { NO_SPECTROGRAM_CACHE } from '../io/stored-spectrogram-cache.js';
import { createRendererReports } from '../state/renderer-reports.js';
import type { ShellContext } from '../commands/shell-context.js';
import { PictureSoundDecoder, type DecodeSound } from '../picture/picture-sound.js';
import { ReferencePicture, type PicturePlatform } from '../picture/reference-picture.js';
import type { ModelGate } from '../assets/model-gate.js';
import { createAssetCatalogue } from '../state/asset-catalogue.js';
import { createChosenFiles } from '../state/chosen-files.js';
import { createClipboardStore } from '../state/clipboard-store.js';
import { createCueStore } from '../state/cue-store.js';
import { createEditorViewStore } from '../state/editor-view-store.js';
import { reconcileSelections } from '../state/selection-reconciling.js';
import { observable } from '../state/observable.js';
import { createSelectionStore } from '../state/selection-store.js';
import type { StateStorage } from '../state/state-storage.js';

/**
 * A gate that refuses nothing, taking every processor's model to be there,
 * for a test of what a project's entries are made of rather than of whether
 * a model can run.
 */
export const OPEN_MODEL_GATE: ModelGate = () => undefined;

/**
 * The frame callbacks waiting on a fake element, which a test fires as the
 * browser would when it presents a frame.
 */
class FakeFrames {
  #next = 1;
  readonly #waiting = new Map<number, VideoFrameRequestCallback>();

  request(callback: VideoFrameRequestCallback): number {
    const handle = this.#next;
    this.#next += 1;
    this.#waiting.set(handle, callback);
    return handle;
  }

  cancel(handle: number): void {
    this.#waiting.delete(handle);
  }

  /** How many callbacks wait for the next frame. */
  get waiting(): number {
    return this.#waiting.size;
  }

  /** Presents the frame stamped `mediaTime` to every callback waiting. */
  present(mediaTime: number): void {
    const due = [...this.#waiting.values()];
    this.#waiting.clear();
    for (const callback of due) {
      callback(0, {
        mediaTime,
        presentationTime: 0,
        expectedDisplayTime: 0,
        presentedFrames: 1,
        width: 320,
        height: 180,
      });
    }
  }
}

/**
 * A video element that loads nothing, and plays, seeks and presents frames only
 * by what it is told. Each time it is sent is recorded in `seeks`. Its size may
 * be redefined, as a file with no picture the browser can decode has none.
 */
function fakeVideo(frames: FakeFrames, seeks: number[]): HTMLVideoElement {
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
    videoWidth: { get: () => 320, configurable: true },
    videoHeight: { get: () => 180, configurable: true },
    currentTime: {
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value;
        seeks.push(value);
      },
    },
    requestVideoFrameCallback: {
      value: (callback: VideoFrameRequestCallback) => frames.request(callback),
    },
    cancelVideoFrameCallback: {
      value: (handle: number) => {
        frames.cancel(handle);
      },
    },
  });
}

/**
 * The picture's platform over a fake element, with the frame callbacks waiting
 * on it and where it was sent, which the test can reach.
 */
export function fakePicturePlatform(framesAnnounced = false): PicturePlatform & {
  readonly frames: FakeFrames;
  readonly seeks: readonly number[];
} {
  const frames = new FakeFrames();
  const seeks: number[] = [];
  return {
    frames,
    seeks,
    createVideo: () => fakeVideo(frames, seeks),
    createUrl: () => 'blob:picture',
    revokeUrl: () => undefined,
    capture: () => Promise.resolve(document.createElement('canvas')),
    framesAnnounced,
  };
}

/**
 * The editor part of a shell context, over the real stores and a fake picture,
 * whose sound is weighed as where the browser says nothing of its memory.
 */
export function fakeEditor(
  storage: StateStorage,
  logger: Logger,
  decode: DecodeSound = () => Promise.resolve('This test decodes no sound.'),
): Pick<
  ShellContext,
  | 'assets'
  | 'selections'
  | 'cues'
  | 'editorViews'
  | 'ids'
  | 'picture'
  | 'pictureSound'
  | 'chosenFiles'
  | 'clipboard'
  | 'modelGate'
> {
  const assets = createAssetCatalogue(testAssets(), logger);
  const picture = new ReferencePicture({ platform: fakePicturePlatform(), logger });
  const selections = createSelectionStore();
  reconcileSelections(selections, assets);
  return {
    assets,
    selections,
    cues: createCueStore(),
    // Written at once, so a test reads back what a view keeps without waiting.
    editorViews: createEditorViewStore(storage, logger, (write) => {
      write();
    }),
    ids: createDeterministicIdGenerator(4),
    picture,
    pictureSound: new PictureSoundDecoder({
      decode,
      picture,
      catalogue: assets,
      logger,
      resources: () => ({ availableMemoryBytes: undefined }),
    }),
    chosenFiles: createChosenFiles(),
    clipboard: createClipboardStore(),
    // The editor's fakes hold no project, whose entries alone a gate refuses.
    modelGate: observable(OPEN_MODEL_GATE),
  };
}

/** A peak worker that takes every message and answers none, for a panel that is only drawn. */
function silentPeakWorker(): PeakWorkerPort {
  return { post: () => undefined, listen: () => undefined, terminate: () => undefined };
}

/** A spectrogram worker that takes every message and answers none, for a panel that is only drawn. */
function silentSpectrogramWorker(): SpectrogramWorkerPort {
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
      spectrograms: new SpectrogramHost({
        createWorker: silentSpectrogramWorker,
        cache: NO_SPECTROGRAM_CACHE,
        report: () => undefined,
        now: () => 0,
      }),
      graphics: { gpu: undefined, pixelRatio: () => 1, watchPixelRatio: () => () => undefined },
      rendererReports: createRendererReports(),
      logger,
    },
  );
}
