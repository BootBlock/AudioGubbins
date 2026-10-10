/**
 * The spectral selection drawn over a lane: each shape of its mask outlined
 * as it was drawn, a rectangle's edges, a lasso's closed path and a brush's
 * path, where its positions and frequencies fall at the view's zoom, in the
 * selection's colour while it is the active facet and quieter while it is
 * not, and only on the lanes of a spectrogram in its channel scope.
 */

import { describe, expect, it } from 'vitest';

import {
  MaskEffect,
  NO_FEATHER,
  type SpectralMask,
  type SpectralShape,
} from '@audiogubbins/domain';
import type { RenderBatch, SegmentBatch } from '@audiogubbins/renderer';
import {
  EMPTY_SELECTION,
  pixelOf,
  pixelsPerSample,
  samplesPerPixel,
  viewportAtStart,
  withChannels,
  withSpectralMask,
  withTimeRange,
  type SelectionSet,
  type ViewportState,
} from '@audiogubbins/timeline';

import { BuilderPool } from './batch-buffers.js';
import { frequencyY } from './frequency-axis.js';
import { LaneKind, type Lane } from './lane-layout.js';
import { drawLaneOverlay, type LaneOverlay } from './overlay-drawing.js';
import type { OverlayStyle } from './ruler-drawing.js';
import { PALETTE, at } from './testing/scene.js';
import type { SpectralSettings } from './view-state.js';

const AXIS: SpectralSettings = { frequencyScale: 'logarithmic', lowest: 20, highest: 20_000 };

const SPECTROGRAM: Lane = {
  channel: 0,
  kind: LaneKind.Spectrogram,
  area: { x: 0, y: 50, width: 1000, height: 200 },
};

const RECTANGLE: SpectralShape = {
  kind: 'rectangle',
  effect: MaskEffect.Add,
  range: { start: at(1_000), end: at(3_000) },
  band: { low: 200, high: 2_000 },
};

const LASSO: SpectralShape = {
  kind: 'polygon',
  effect: MaskEffect.Add,
  points: [
    { position: at(4_000), frequency: 100 },
    { position: at(6_000), frequency: 400 },
    { position: at(5_000), frequency: 5_000 },
    { position: at(4_500), frequency: 900 },
  ],
};

const STROKE: SpectralShape = {
  kind: 'stroke',
  effect: MaskEffect.Subtract,
  hardness: 0.5,
  points: [
    { position: at(2_000), frequency: 300, strength: 1, radius: { time: 50, frequency: 30 } },
    { position: at(2_500), frequency: 600, strength: 0.5, radius: { time: 50, frequency: 60 } },
    { position: at(2_900), frequency: 700, strength: 0.75, radius: { time: 50, frequency: 70 } },
  ],
};

function mask(...shapes: readonly [SpectralShape, ...SpectralShape[]]): SpectralMask {
  return { shapes, feather: NO_FEATHER };
}

function style(viewport: ViewportState): OverlayStyle {
  return {
    viewport,
    pixelRatio: 1,
    palette: PALETTE,
    type: { label: '12px sans-serif', small: '11px sans-serif' },
  };
}

/** Ten samples a pixel, from the start. */
const VIEW = viewportAtStart(samplesPerPixel(10), 1000);

function overlay(selection: SelectionSet): LaneOverlay {
  return {
    selection,
    markers: [],
    regions: [],
    playhead: undefined,
    preview: undefined,
    grid: undefined,
    spectral: AXIS,
  };
}

function drawn(selection: SelectionSet, lane = SPECTROGRAM, viewport = VIEW): RenderBatch[] {
  const out: RenderBatch[] = [];
  drawLaneOverlay(new BuilderPool(), lane, overlay(selection), style(viewport), out);
  return out;
}

/** The segments drawn in `colour`, each as its two ends. */
function segments(batches: readonly RenderBatch[], colour: readonly number[]): number[][] {
  return batches
    .filter((batch): batch is SegmentBatch => batch.kind === 'segments')
    .filter((batch) => batch.colour === colour)
    .flatMap((batch) =>
      Array.from({ length: batch.count }, (_, index) =>
        Array.from(batch.values.subarray(index * 4, index * 4 + 4)),
      ),
    );
}

/** Where a point of the mask is drawn, as a segment's values hold it. */
function placed(viewport: ViewportState, position: number, frequency: number): number[] {
  return [
    Math.fround(pixelOf(viewport, position)),
    Math.fround(frequencyY(SPECTROGRAM, frequency, AXIS)),
  ];
}

function segment(viewport: ViewportState, from: [number, number], to: [number, number]): number[] {
  return [...placed(viewport, ...from), ...placed(viewport, ...to)];
}

describe('the spectral selection drawn over a lane', () => {
  it('outlines a rectangle by its four edges, where its range and band fall', () => {
    const outline = segments(
      drawn(withSpectralMask(EMPTY_SELECTION, mask(RECTANGLE))),
      PALETTE.selectionBorder,
    );
    expect(outline).toEqual([
      segment(VIEW, [1_000, 2_000], [3_000, 2_000]),
      segment(VIEW, [3_000, 2_000], [3_000, 200]),
      segment(VIEW, [3_000, 200], [1_000, 200]),
      segment(VIEW, [1_000, 200], [1_000, 2_000]),
    ]);
  });

  it('outlines a lasso by its closed path, its last point joined to its first', () => {
    const outline = segments(
      drawn(withSpectralMask(EMPTY_SELECTION, mask(LASSO))),
      PALETTE.selectionBorder,
    );
    expect(outline).toEqual([
      segment(VIEW, [4_000, 100], [6_000, 400]),
      segment(VIEW, [6_000, 400], [5_000, 5_000]),
      segment(VIEW, [5_000, 5_000], [4_500, 900]),
      segment(VIEW, [4_500, 900], [4_000, 100]),
    ]);
  });

  it('outlines a brush stroke by its path, left open', () => {
    const outline = segments(
      drawn(withSpectralMask(EMPTY_SELECTION, mask(RECTANGLE, STROKE))),
      PALETTE.selectionBorder,
    );
    expect(outline.slice(4)).toEqual([
      segment(VIEW, [2_000, 300], [2_500, 600]),
      segment(VIEW, [2_500, 600], [2_900, 700]),
    ]);
  });

  it('draws the outline where the mask lies at each zoom, so it stays on what it selects', () => {
    const selection = withSpectralMask(EMPTY_SELECTION, mask(RECTANGLE));
    for (const viewport of [
      VIEW,
      viewportAtStart(samplesPerPixel(3), 1000),
      { ...viewportAtStart(pixelsPerSample(4), 1000), start: at(900), offset: 2 },
    ]) {
      const [top] = segments(drawn(selection, SPECTROGRAM, viewport), PALETTE.selectionBorder);
      expect(top).toEqual(segment(viewport, [1_000, 2_000], [3_000, 2_000]));
    }
  });

  it('draws the same outline every time the same selection is drawn', () => {
    const selection = withSpectralMask(EMPTY_SELECTION, mask(RECTANGLE, LASSO, STROKE));
    expect(segments(drawn(selection), PALETTE.selectionBorder)).toEqual(
      segments(drawn(selection), PALETTE.selectionBorder),
    );
  });

  it('draws a kept spectral selection quieter while another facet is active', () => {
    const selection = withTimeRange(withSpectralMask(EMPTY_SELECTION, mask(RECTANGLE)), {
      start: at(0),
      end: at(10),
    });
    const batches = drawn(selection);
    expect(segments(batches, PALETTE.selectionBorder)).toEqual([]);
    expect(segments(batches, PALETTE.quietText)).toHaveLength(4);
  });

  it('draws nothing of it on a waveform lane, which has no frequency', () => {
    const waveform: Lane = { ...SPECTROGRAM, kind: LaneKind.Waveform };
    const batches = drawn(withSpectralMask(EMPTY_SELECTION, mask(RECTANGLE)), waveform);
    expect(batches.filter((batch) => batch.kind === 'segments')).toEqual([]);
  });

  it('draws it over the spectrogram an overlay lane shows', () => {
    const lane: Lane = { ...SPECTROGRAM, kind: LaneKind.Overlay };
    const batches = drawn(withSpectralMask(EMPTY_SELECTION, mask(RECTANGLE)), lane);
    expect(segments(batches, PALETTE.selectionBorder)).toHaveLength(4);
  });

  it('draws it only on the lanes of the channels it is scoped to', () => {
    const scoped = withChannels(withSpectralMask(EMPTY_SELECTION, mask(RECTANGLE)), [1], 2);
    expect(segments(drawn(scoped), PALETTE.selectionBorder)).toEqual([]);
    expect(
      segments(drawn(scoped, { ...SPECTROGRAM, channel: 1 }), PALETTE.selectionBorder),
    ).toHaveLength(4);
  });
});
