import { describe, expect, it } from 'vitest';

import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import { PeakHost, type PeakCacheStore, type PeakWorkerPort } from '@audiogubbins/waveform';

import { testAssets } from '../assets/test-assets.js';
import { createEditorViewStore } from '../state/editor-view-store.js';
import { createAssetCatalogue } from '../state/asset-catalogue.js';
import { createStateStorage } from '../state/state-storage.js';
import { ephemeralStorage } from '../testing/ephemeral-storage.js';
import { holdShownPeaks } from './shown-peaks.js';
import { ViewAudio } from './view-audio.js';

/** A worker that records what it is told and answers nothing, so a pyramid stays half made. */
function silentWorker() {
  const kinds: string[] = [];
  const port: PeakWorkerPort = {
    post: (message) => kinds.push(message.kind),
    listen: () => undefined,
    terminate: () => undefined,
  };
  return { port, kinds };
}

const NO_CACHE: PeakCacheStore = {
  read: () => Promise.resolve(undefined),
  write: () => Promise.resolve(),
};

/** Lets the cache read and the job start. */
function settled(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

const logger = createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('editor');

describe('the peaks of the assets views show', () => {
  it('outlive a view surface mounted again, so a half-made pyramid is not begun again', async () => {
    const worker = silentWorker();
    const peaks = new PeakHost({
      createWorker: () => worker.port,
      cache: NO_CACHE,
      report: () => undefined,
    });
    const assets = createAssetCatalogue(testAssets(), logger);
    const editorViews = createEditorViewStore(
      createStateStorage(ephemeralStorage(), logger, () => undefined),
      logger,
      (write) => {
        write();
      },
    );
    const [asset] = assets.get().assets;
    if (asset === undefined) throw new Error('No test asset.');
    editorViews.open('editor', asset);
    holdShownPeaks(editorViews, assets, peaks);
    const options = {
      peaks,
      asset,
      changed: () => undefined,
      progressed: () => undefined,
      failed: () => undefined,
    };

    const viewport = () => {
      const entry = editorViews.entry('editor');
      if (entry === undefined) throw new Error('No view.');
      return entry.state.viewport;
    };

    const mounted = new ViewAudio(options);
    await settled();
    const pyramid = mounted.known(viewport(), 1).pyramid;
    mounted.release();
    const again = new ViewAudio(options);

    expect(again.known(viewport(), 1).pyramid).toBe(pyramid);
    expect(worker.kinds).not.toContain('close');
    again.release();
    editorViews.forgetClosed([]);
    expect(worker.kinds).toContain('close');
  });
});
