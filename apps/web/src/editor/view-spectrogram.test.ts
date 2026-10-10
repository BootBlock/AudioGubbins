import { afterEach, describe, expect, it } from 'vitest';

import { MAXIMUM_QUALITY } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { DisplayMode, newViewState, type EditorViewState } from '@audiogubbins/editor-view';
import { SpectrogramHost, ToSpectrogramWorkerKind } from '@audiogubbins/spectral-analysis';
import {
  LocalSpectrogramWorker,
  MemoryTileCache,
  turn,
} from '@audiogubbins/spectral-analysis/testing';
import { samplesPerPixel, scrolledBy, viewportAtStart } from '@audiogubbins/timeline';

import { testAssets } from '../assets/test-assets.js';
import { ViewSpectrogram } from './view-spectrogram.js';

const [FIRST] = expectSuccess(testAssets());
if (FIRST === undefined) throw new Error('No test asset.');
const TONES = FIRST;

let host: SpectrogramHost | undefined;

afterEach(() => {
  host?.dispose();
  host = undefined;
});

/** A view of the tone bursts' spectrogram over the real worker core, and what it was told. */
function viewOver() {
  const workers: LocalSpectrogramWorker[] = [];
  host = new SpectrogramHost({
    createWorker: () => {
      const worker = new LocalSpectrogramWorker();
      workers.push(worker);
      return worker;
    },
    cache: new MemoryTileCache(),
    report: () => undefined,
    now: () => 0,
  });
  const told = { progressed: 0 };
  const view = new ViewSpectrogram({
    spectrograms: host,
    asset: TONES,
    quality: MAXIMUM_QUALITY,
    progressed: () => {
      told.progressed += 1;
    },
  });
  const focuses = (): number =>
    workers
      .flatMap((worker) => worker.sent)
      .filter((message) => message.kind === ToSpectrogramWorkerKind.Focus).length;
  return { view, workers, told, focuses };
}

/** The first 64,000 frames of the tone bursts, a spectrogram lane for each channel. */
const SHOWN: EditorViewState = {
  ...newViewState(TONES.length, 1000),
  viewport: viewportAtStart(samplesPerPixel(64), 1000),
  displayMode: DisplayMode.Spectrogram,
};

describe("a view's spectrogram (ADR-0080)", () => {
  it('tells the host what it shows only when that changes, and draws the tiles that come', async () => {
    const { view, told, focuses } = viewOver();
    const known = view.known(SHOWN, 1);
    view.known(SHOWN, 1);
    expect(focuses()).toBe(1);
    expect(view.known(SHOWN, 1)).toBe(known);

    view.known({ ...SHOWN, viewport: scrolledBy(SHOWN.viewport, 100, TONES.length) }, 1);
    expect(focuses()).toBe(2);

    if (known.kind !== 'tiles') throw new Error('The spectrogram is not drawn.');
    for (let tries = 0; tries < 400 && known.tile(0, 0, 0) === undefined; tries += 1) await turn();
    expect(known.tile(0, 0, 0)?.stale).toBe(false);
    expect(told.progressed).toBeGreaterThan(0);
    expect(view.version).toBe(told.progressed);
    view.release();
  });

  it('says why its lanes are not drawn once the worker fails', async () => {
    const { view, workers, told } = viewOver();
    view.known(SHOWN, 1);
    await turn();
    workers[0]?.fault('It ran out of memory.');

    expect(view.known(SHOWN, 1)).toEqual({
      kind: 'not-drawn',
      reason: 'The spectrogram worker stopped: It ran out of memory.',
    });
    expect(told.progressed).toBeGreaterThan(0);
    view.release();
  });

  it('draws another analysis’s pyramid when the view’s settings change', () => {
    const { view } = viewOver();
    const before = view.known(SHOWN, 1);
    const after = view.known(
      {
        ...SHOWN,
        spectrogram: {
          ...SHOWN.spectrogram,
          analysis: { ...SHOWN.spectrogram.analysis, windowLength: 512 },
        },
      },
      1,
    );
    expect(before.kind === 'tiles' && after.kind === 'tiles').toBe(true);
    if (before.kind !== 'tiles' || after.kind !== 'tiles') return;
    expect(after.geometry.config.windowLength).toBe(512);
    expect(after.geometry.levels.length).toBeGreaterThan(before.geometry.levels.length);
    view.release();
  });
});
