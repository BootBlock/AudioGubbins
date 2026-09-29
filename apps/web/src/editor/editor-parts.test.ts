import { describe, expect, it } from 'vitest';

import { sampleCount, type SampleCount } from '@audiogubbins/domain';
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

  it('places the playhead where the razor would split, as clip editing will', () => {
    expect(commandsOf({ kind: 'split-at', position: at(480) }, 'editor')).toEqual([
      { id: 'editor.set-playhead', args: { view: 'editor', position: 480 } },
    ]);
  });

  it('zooms about the pixel the zoom tool was clicked at', () => {
    expect(commandsOf({ kind: 'zoom-step', x: 120, direction: 'out' }, 'editor')).toEqual([
      { id: 'editor.zoom-out', args: { view: 'editor', anchor: 120 } },
    ]);
  });
});

describe("a view's audio", () => {
  /** A peak host whose one handle records what it is asked, answering windows at once. */
  function recordingHost() {
    const asked: { start: number; end: number }[] = [];
    const focused: { start: number; end: number }[] = [];
    let released = 0;
    const handle: PeakHandle = {
      pyramid: new WaveformPeakPyramid(peakGeometry(TONES.length, 2)),
      status: { kind: 'complete' },
      subscribe: () => () => undefined,
      focus: (range) => focused.push(range),
      samples: (range) => {
        asked.push(range);
        return Promise.resolve({
          start: range.start,
          channels: [new Float32Array(range.end - range.start)],
        });
      },
      zeroCrossings: { nearest: () => Promise.resolve(undefined) },
      release: () => {
        released += 1;
      },
    };
    const host: Pick<PeakHost, 'open'> = { open: () => handle };
    return { host, asked, focused, released: () => released };
  }

  it('reads the pyramid alone where a pixel holds many buckets', () => {
    const { host, asked, focused } = recordingHost();
    const audio = new ViewAudio({
      peaks: host,
      asset: TONES,
      changed: () => undefined,
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
      changed: () => {
        changes += 1;
      },
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
    await Promise.resolve();
    const known = audio.known(viewport, 1);

    expect(asked).toEqual([{ start: 99_875, end: 100_375 }]);
    expect(known.samples?.start).toBe(99_875);
    expect(changes).toBe(1);
    audio.release();
  });
});
