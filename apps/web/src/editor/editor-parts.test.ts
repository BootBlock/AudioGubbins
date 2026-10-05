import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_QUALITY,
  RegionBoundary,
  sampleCount,
  unsafeBrandId,
  type SampleCount,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { FollowMode, newViewState, type EditorViewState } from '@audiogubbins/editor-view';
import { samplesPerPixel, pixelsPerSample, type ViewportState } from '@audiogubbins/timeline';
import {
  WaveformPeakPyramid,
  peakGeometry,
  type PeakHandle,
  type PeakHost,
} from '@audiogubbins/waveform';

import { testAssets } from '../assets/test-assets.js';
import { commandsOf } from './intent-commands.js';
import { ViewAudio } from './view-audio.js';
import { followingScroll } from './view-sources.js';

const at = (value: number): SampleCount => expectSuccess(sampleCount(value));
const TONES = (() => {
  const [first] = expectSuccess(testAssets());
  if (first === undefined) throw new Error('No test asset.');
  return first;
})();

/** A view of 1000 pixels at `viewport`'s zoom and edge, following as `follow` says. */
function viewAt(viewport: Partial<ViewportState>, follow: FollowMode): EditorViewState {
  const state = newViewState(at(480_000), 1000);
  return { ...state, follow, viewport: { ...state.viewport, ...viewport } };
}

describe('following the playhead', () => {
  const view = (follow: FollowMode) =>
    viewAt({ start: at(10_000), zoom: samplesPerPixel(10) }, follow);

  it('turns a page once the playhead leaves the view, and not before', () => {
    expect(followingScroll(view(FollowMode.Page), at(19_990), at(480_000))).toBeUndefined();
    expect(followingScroll(view(FollowMode.Page), at(20_000), at(480_000))).toBe(20_000);
  });

  it('keeps the playhead in the middle', () => {
    expect(followingScroll(view(FollowMode.Centre), at(15_000), at(480_000))).toBeUndefined();
    expect(followingScroll(view(FollowMode.Centre), at(15_100), at(480_000))).toBe(10_100);
  });

  it('does nothing where the view does not follow', () => {
    expect(followingScroll(view(FollowMode.Off), at(90_000), at(480_000))).toBeUndefined();
  });
});

describe('what a tool intent runs', () => {
  it('names the view it was made in, and writes a channel scope as a list', () => {
    expect(
      commandsOf(
        { kind: 'select-time', range: { start: at(10), end: at(20) }, channels: [0, 2] },
        'editor-2',
      ),
    ).toEqual([
      { id: 'editor.select-time', args: { view: 'editor-2', start: 10, end: 20, channels: '0,2' } },
    ]);
  });

  it('splits where the razor clicks', () => {
    expect(commandsOf({ kind: 'split-at', position: at(480) }, 'editor')).toEqual([
      { id: 'edit.split', args: { view: 'editor', at: 480 } },
    ]);
  });

  it('makes a region of what the region tool dragged over, by selecting it first', () => {
    expect(
      commandsOf({ kind: 'make-region', range: { start: at(480), end: at(960) } }, 'editor'),
    ).toEqual([
      { id: 'editor.select-time', args: { view: 'editor', start: 480, end: 960 } },
      { id: 'region.create', args: { view: 'editor' } },
    ]);
  });

  it('moves the end of a region dragged by the command for that end', () => {
    const id = unsafeBrandId<'RegionId'>('region-1');
    expect(
      commandsOf(
        { kind: 'move-region-boundary', id, boundary: RegionBoundary.Start, to: at(480) },
        'editor',
      ),
    ).toEqual([{ id: 'region.move-start', args: { view: 'editor', region: id, to: 480 } }]);
    expect(
      commandsOf(
        { kind: 'move-region-boundary', id, boundary: RegionBoundary.End, to: at(960) },
        'editor',
      ),
    ).toEqual([{ id: 'region.move-end', args: { view: 'editor', region: id, to: 960 } }]);
  });

  it('zooms about the pixel the zoom tool was clicked at', () => {
    expect(commandsOf({ kind: 'zoom-step', x: 120, direction: 'out' }, 'editor')).toEqual([
      { id: 'editor.zoom-out', args: { view: 'editor', anchor: 120 } },
    ]);
  });
});

describe("a view's audio", () => {
  /** Lets the windows asked for be answered, and the view told. */
  function answered(): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  /** A peak host whose one handle records what it is asked, answering windows at once. */
  function recordingHost() {
    const asked: { start: number; end: number }[] = [];
    const focused: { start: number; end: number }[] = [];
    const abandoned: { start: number; end: number }[] = [];
    let released = 0;
    const handle: PeakHandle = {
      pyramid: new WaveformPeakPyramid(peakGeometry(TONES.length, 2)),
      status: { kind: 'complete' },
      subscribe: () => () => undefined,
      focus: (range) => focused.push(range),
      samples: (range, signal) => {
        asked.push(range);
        signal?.addEventListener('abort', () => abandoned.push(range));
        return Promise.resolve({
          start: range.start,
          channels: [new Float32Array(range.end - range.start)],
        });
      },
      buckets: (range, signal) => {
        asked.push(range);
        signal?.addEventListener('abort', () => abandoned.push(range));
        const frames = range.end - range.start;
        const buckets = Math.ceil(frames / 16);
        return Promise.resolve({
          start: range.start,
          frames,
          bucketFrames: 16,
          channels: [
            {
              minimum: new Int16Array(buckets),
              maximum: new Int16Array(buckets),
              rms: new Int16Array(buckets),
              clipped: new Uint8Array(buckets),
            },
          ],
        });
      },
      zeroCrossings: { nearest: () => Promise.resolve(undefined) },
      release: () => {
        released += 1;
      },
    };
    const host: Pick<PeakHost, 'open'> = { open: () => handle };
    return { host, asked, focused, abandoned, released: () => released };
  }

  it('reads the pyramid alone where a pixel holds many buckets', () => {
    const { host, asked, focused } = recordingHost();
    const audio = new ViewAudio({
      peaks: host,
      asset: TONES,
      quality: MAXIMUM_QUALITY,
      changed: () => undefined,
      progressed: () => undefined,
      failed: () => undefined,
    });

    audio.known({ ...newViewState(TONES.length, 1000).viewport }, 1);

    expect(asked).toEqual([]);
    expect(focused).toEqual([{ start: 0, end: 480_000 }]);
  });

  it('asks for a window of samples around a view zoomed past the pyramid, once', async () => {
    const { host, asked } = recordingHost();
    let changes = 0;
    const audio = new ViewAudio({
      peaks: host,
      asset: TONES,
      quality: MAXIMUM_QUALITY,
      changed: () => {
        changes += 1;
      },
      progressed: () => undefined,
      failed: () => undefined,
    });
    const viewport: ViewportState = {
      start: at(100_000),
      offset: 0,
      zoom: pixelsPerSample(4),
      width: 1000,
    };

    audio.known(viewport, 1);
    audio.known(viewport, 1);
    await answered();
    const known = audio.known(viewport, 1);

    expect(asked).toEqual([{ start: 99_750, end: 100_500 }]);
    expect(known.samples?.start).toBe(99_750);
    expect(changes).toBe(1);
    audio.release();
  });

  it('asks once for the widest window a view wider than any window can have, and not again', async () => {
    const long = expectSuccess(testAssets()).find((asset) => asset.id === 'test:long-session');
    if (long === undefined) throw new Error('No long session.');
    for (const samples of [15, 255]) {
      const { host, asked } = recordingHost();
      let changes = 0;
      const audio = new ViewAudio({
        peaks: host,
        asset: long,
        quality: MAXIMUM_QUALITY,
        changed: () => {
          changes += 1;
        },
        progressed: () => undefined,
        failed: () => undefined,
      });
      const viewport: ViewportState = {
        start: at(10_000_000),
        offset: 0,
        zoom: samplesPerPixel(samples),
        width: 60_000,
      };

      for (let frame = 0; frame < 5; frame += 1) {
        audio.known(viewport, 1);
        await answered();
      }

      expect(asked).toHaveLength(1);
      expect(changes).toBe(1);
      audio.release();
    }
  });

  it('reads detail buckets, not samples, where a column holds sixteen samples or more', async () => {
    const { host, asked } = recordingHost();
    const audio = new ViewAudio({
      peaks: host,
      asset: TONES,
      quality: MAXIMUM_QUALITY,
      changed: () => undefined,
      progressed: () => undefined,
      failed: () => undefined,
    });
    const viewport: ViewportState = {
      start: at(100_000),
      offset: 0,
      zoom: samplesPerPixel(100),
      width: 1000,
    };

    audio.known(viewport, 2);
    await answered();
    const known = audio.known(viewport, 2);

    expect(known.buckets?.start).toBe(0);
    expect(known.samples).toBeUndefined();
    expect(asked).toEqual([{ start: 0, end: 300_000 }]);
    audio.release();
  });

  it('keeps drawing from its window while it scrolls within half a span of it, then asks for the next and drops the last ask', async () => {
    const { host, asked, abandoned } = recordingHost();
    const audio = new ViewAudio({
      peaks: host,
      asset: TONES,
      quality: MAXIMUM_QUALITY,
      changed: () => undefined,
      progressed: () => undefined,
      failed: () => undefined,
    });
    const view = (start: number): ViewportState => ({
      start: at(start),
      offset: 0,
      zoom: samplesPerPixel(4),
      width: 1000,
    });

    audio.known(view(100_000), 1);
    await answered();
    audio.known(view(101_500), 1);
    audio.known(view(103_000), 1);
    audio.known(view(106_000), 1);

    expect(asked).toEqual([
      { start: 96_000, end: 108_000 },
      { start: 99_000, end: 111_000 },
      { start: 102_000, end: 114_000 },
    ]);
    expect(abandoned).toEqual([{ start: 99_000, end: 111_000 }]);
    audio.release();
  });
});
