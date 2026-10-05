/**
 * Frames composed from a view's state: every lane drawn, what is not yet known
 * drawn as pending, the selection washed over the lanes it covers, the
 * spectrogram lane's shell, and the same frame from the same state.
 */

import { describe, expect, it } from 'vitest';

import { RegionBoundary } from '@audiogubbins/domain';
import type { RenderBatch, RenderFrame } from '@audiogubbins/renderer';
import {
  EMPTY_SELECTION,
  pixelsPerSample,
  viewportAtStart,
  withChannels,
  withObjects,
  withTimeRange,
} from '@audiogubbins/timeline';
import { WaveformPeakPyramid, peakGeometry } from '@audiogubbins/waveform';

import { FrameComposer, SPECTROGRAM_SHELL_NOTE } from './frame-composer.js';
import { PALETTE, at, marker, region, scene } from './testing/scene.js';
import { DisplayMode } from './view-state.js';

/** The batches of the frame's lane layers, lane by lane. */
function laneBatches(frame: RenderFrame, lanes: number): readonly (readonly RenderBatch[])[] {
  return frame.layers.slice(0, lanes).map((layer) => layer.batches);
}

function rectanglesOf(batches: readonly RenderBatch[], colour: readonly number[]): number {
  return batches
    .filter((batch) => batch.kind === 'rectangles' && batch.colour === colour)
    .reduce((sum, batch) => sum + (batch.kind === 'rectangles' ? batch.count : 0), 0);
}

function texts(frame: RenderFrame): readonly string[] {
  return frame.layers.flatMap((layer) =>
    layer.batches.flatMap((batch) =>
      batch.kind === 'text' ? batch.labels.map((label) => label.text) : [],
    ),
  );
}

describe('composing a frame', () => {
  it('draws each lane of a pyramid not yet known as pending, one column a device pixel', () => {
    const pyramid = new WaveformPeakPyramid(peakGeometry(100_000, 2));
    const composer = new FrameComposer();
    const composed = composer.compose(
      scene({
        pixelRatio: 2,
        audio: { pyramid, buckets: undefined, samples: undefined, length: at(100_000) },
      }),
    );
    expect(composer.waiting).toBe(true);
    for (const batches of laneBatches(composed, 2)) {
      expect(rectanglesOf(batches, PALETTE.pending)).toBe(2000);
      expect(rectanglesOf(batches, PALETTE.peak)).toBe(0);
    }
    expect(composed.pixelRatio).toBe(2);
  });

  it('draws a known column as its envelope and its root mean square', () => {
    // A million frames in a thousand pixels is a thousand a column: read from the pyramid.
    const geometry = peakGeometry(1_000_000, 1);
    const pyramid = new WaveformPeakPyramid(geometry);
    for (const [index, level] of pyramid.levels.entries()) {
      pyramid.apply({
        level: index,
        first: 0,
        channels: [
          {
            minimum: new Int16Array(level.buckets).fill(-4096),
            maximum: new Int16Array(level.buckets).fill(4096),
            rms: new Int16Array(level.buckets).fill(2048),
            clipped: new Uint8Array(level.buckets),
          },
        ],
      });
    }
    const composer = new FrameComposer();
    const composed = composer.compose(
      scene({
        channels: 1,
        length: 1_000_000,
        audio: { pyramid, buckets: undefined, samples: undefined, length: at(1_000_000) },
      }),
    );
    const [batches] = laneBatches(composed, 1);
    expect(composer.waiting).toBe(false);
    expect(rectanglesOf(batches!, PALETTE.peak)).toBe(1000);
    expect(rectanglesOf(batches!, PALETTE.rms)).toBe(1000);
    expect(rectanglesOf(batches!, PALETTE.pending)).toBe(0);
  });

  it('draws each sample as a point joined to the next where a sample is wider than a pixel', () => {
    const samples = {
      start: 0,
      channels: [Float32Array.from({ length: 200 }, (_, index) => Math.sin(index / 10))],
    };
    const composed = new FrameComposer().compose(
      scene({
        channels: 1,
        state: (state) => ({ ...state, viewport: viewportAtStart(pixelsPerSample(10), 1000) }),
        audio: { pyramid: undefined, buckets: undefined, samples, length: at(100_000) },
      }),
    );
    const [batches] = laneBatches(composed, 1);
    const lines = batches!.find((batch) => batch.kind === 'segments');
    expect(lines?.kind === 'segments' ? lines.count : 0).toBe(100);
    expect(rectanglesOf(batches!, PALETTE.peak)).toBe(101);
  });

  it('washes the active time selection over the lanes of its channels, and a kept one more quietly', () => {
    const narrowed = withChannels(
      withTimeRange(EMPTY_SELECTION, { start: at(1000), end: at(5000) }),
      [1],
      3,
    );
    const composed = new FrameComposer().compose(scene({ channels: 3, selection: narrowed }));
    expect(
      laneBatches(composed, 3).map((batches) => rectanglesOf(batches, PALETTE.selectionFill)),
    ).toEqual([0, 1, 0]);
    const kept = withObjects(narrowed, { kind: 'markers', ids: [marker('m', 1).id] });
    const quiet = new FrameComposer().compose(scene({ channels: 3, selection: kept }));
    expect(
      laneBatches(quiet, 3).map((batches) => rectanglesOf(batches, PALETTE.inactiveSelectionFill)),
    ).toEqual([0, 1, 0]);
  });

  it('gives a spectrogram lane its frequency axis and says what draws it', () => {
    const composed = new FrameComposer().compose(
      scene({
        channels: 1,
        state: (state) => ({ ...state, displayMode: DisplayMode.Spectrogram }),
      }),
    );
    expect(texts(composed)).toEqual(
      expect.arrayContaining(['100 Hz', '1 kHz', '10 kHz', SPECTROGRAM_SHELL_NOTE]),
    );
  });

  it('leaves out a marker name that would run into the one before it, and keeps its mark', () => {
    // 100,000 frames in 1000 pixels: a hundred frames a pixel.
    const crowded = new FrameComposer().compose(
      scene({
        content: {
          length: at(100_000),
          channelNames: ['Left', 'Right'],
          markers: [marker('Attack', 0), marker('Sustain', 500), marker('Release', 50_000)],
          regions: [],
        },
      }),
    );

    expect(
      texts(crowded).filter((text) => ['Attack', 'Sustain', 'Release'].includes(text)),
    ).toEqual(['Attack', 'Release']);
    // Every mark is still drawn in the strip, the second without its name.
    const strip = crowded.layers.find((layer) => layer.clip?.y === 24 && layer.clip.height === 18);
    expect(rectanglesOf(strip?.batches ?? [], PALETTE.marker)).toBe(3);
  });

  it('draws the end of a region being dragged where the drag is, in the strip and across the lanes', () => {
    const dragged = region('r', 10_000, 20_000);
    const composed = new FrameComposer().compose(
      scene({
        content: { length: at(100_000), channelNames: ['L', 'R'], markers: [], regions: [dragged] },
        preview: {
          kind: 'region-boundary',
          id: dragged.id,
          boundary: RegionBoundary.End,
          position: at(50_000),
        },
      }),
    );

    // A hundred frames a pixel: the span runs from 100 to where the end is dragged, at 500.
    const strip = composed.layers.find((layer) => layer.clip?.y === 24 && layer.clip.height === 18);
    const span = strip?.batches.find(
      (batch) => batch.kind === 'rectangles' && batch.colour === PALETTE.region,
    );
    expect(span?.kind === 'rectangles' ? [span.values[0], span.values[2]] : []).toEqual([100, 400]);
    expect(laneBatches(composed, 2).map((batches) => rectanglesOf(batches, PALETTE.snap))).toEqual([
      1, 1,
    ]);
  });

  it('draws a selected region’s span in the strip apart from the others', () => {
    const chosen = region('chosen', 10_000, 20_000);
    const composed = new FrameComposer().compose(
      scene({
        content: {
          length: at(100_000),
          channelNames: ['L', 'R'],
          markers: [],
          regions: [chosen, region('other', 50_000, 10_000)],
        },
        selection: withObjects(EMPTY_SELECTION, { kind: 'regions', ids: [chosen.id] }),
      }),
    );

    const strip = composed.layers.find((layer) => layer.clip?.y === 24 && layer.clip.height === 18);
    expect(rectanglesOf(strip?.batches ?? [], PALETTE.selectedRegion)).toBe(1);
    expect(rectanglesOf(strip?.batches ?? [], PALETTE.region)).toBe(1);
  });

  it('composes the same frame from the same state, so a lost device is recovered by composing it again', () => {
    const composer = new FrameComposer();
    const given = scene({
      playhead: at(2000),
      content: {
        length: at(100_000),
        channelNames: ['L', 'R'],
        markers: [marker('m', 3000)],
        regions: [],
      },
    });
    const once = JSON.stringify(composer.compose(given), (_key, value: unknown) =>
      value instanceof Float32Array ? [...value] : value,
    );
    const twice = JSON.stringify(composer.compose(given), (_key, value: unknown) =>
      value instanceof Float32Array ? [...value] : value,
    );
    expect(twice).toBe(once);
  });
});
