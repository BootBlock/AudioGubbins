import { describe, expect, it } from 'vitest';

import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import { MAXIMUM_QUALITY, QualityLevel, namedQualityMode } from '@audiogubbins/domain';
import {
  PeakHost,
  type PeakCacheStore,
  type PeakSubject,
  type PeakWorkerPort,
} from '@audiogubbins/waveform';

import { testAssets } from '../assets/test-assets.js';
import { createAudioSettingsStore } from '../state/audio-settings-store.js';
import { createEditorViewStore } from '../state/editor-view-store.js';
import { createAssetCatalogue } from '../state/asset-catalogue.js';
import { createStateStorage } from '../state/state-storage.js';
import { ephemeralStorage } from '../testing/ephemeral-storage.js';
import { holdShownPeaks } from './shown-peaks.js';
import { ViewAudio, peakSubjectOf } from './view-audio.js';

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

/** An editor showing the first test asset, its peaks held at the chosen render quality of its settings. */
function showing() {
  const worker = silentWorker();
  const peaks = new PeakHost({
    createWorker: () => worker.port,
    cache: NO_CACHE,
    report: () => undefined,
  });
  const storage = createStateStorage(ephemeralStorage(), logger, () => undefined);
  const assets = createAssetCatalogue(testAssets(), logger);
  const editorViews = createEditorViewStore(storage, logger, (write) => {
    write();
  });
  const audioSettings = createAudioSettingsStore(storage, logger);
  const [asset] = assets.get().assets;
  if (asset === undefined) throw new Error('No test asset.');
  editorViews.open('editor', asset);
  const opened: PeakSubject[] = [];
  const recording = {
    open: (subject: PeakSubject) => {
      opened.push(subject);
      return peaks.open(subject);
    },
  };
  return { worker, peaks: recording, assets, editorViews, audioSettings, asset, opened };
}

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
    const audioSettings = createAudioSettingsStore(
      createStateStorage(ephemeralStorage(), logger, () => undefined),
      logger,
    );
    holdShownPeaks(editorViews, assets, audioSettings, peaks);
    const options = {
      peaks,
      asset,
      quality: MAXIMUM_QUALITY,
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

describe('the peaks at the chosen render quality', () => {
  it('are held at the chosen render quality, named in their revision', () => {
    const { peaks, assets, editorViews, audioSettings, asset, opened } = showing();

    holdShownPeaks(editorViews, assets, audioSettings, peaks);

    expect(opened).toHaveLength(1);
    expect(opened[0]?.quality).toBe(MAXIMUM_QUALITY);
    expect(opened[0]?.revision).toBe(peakSubjectOf(asset, MAXIMUM_QUALITY).revision);
  });

  it('are let go and made again when the render quality changes', async () => {
    const { worker, peaks, assets, editorViews, audioSettings, opened } = showing();
    holdShownPeaks(editorViews, assets, audioSettings, peaks);
    await settled();
    const draft = namedQualityMode(QualityLevel.Draft);

    audioSettings.chooseRenderQuality(draft);
    await settled();

    expect(opened.map((subject) => subject.quality.level)).toEqual([
      QualityLevel.Maximum,
      QualityLevel.Draft,
    ]);
    expect(opened[0]?.revision).not.toBe(opened[1]?.revision);
    expect(worker.kinds).toContain('close');
  });

  it('name a revision for each asset revision and each value a final render runs at', () => {
    const { asset } = showing();
    const draft = namedQualityMode(QualityLevel.Draft);

    expect(peakSubjectOf(asset, draft).revision).not.toBe(
      peakSubjectOf(asset, MAXIMUM_QUALITY).revision,
    );
    expect(peakSubjectOf({ ...asset, revision: 'another' }, draft).revision).not.toBe(
      peakSubjectOf(asset, draft).revision,
    );
    expect(peakSubjectOf(asset, draft)).toMatchObject({ identity: asset.id, quality: draft });
  });
});
