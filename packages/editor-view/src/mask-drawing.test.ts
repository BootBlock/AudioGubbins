/**
 * A spectral mask's weight drawn over a lane: read from the domain's weight at
 * every device pixel the mask reaches, through a ramp of the selection's
 * colour, quieter while another facet is active, kept from frame to frame
 * while nothing it is drawn from changes, and the same after the composer and
 * the renderer are made again. The spectral edits of an asset are outlined in
 * their own colour, beneath the selection, where the view's overlays include
 * them; and a spectral drag shows the selection it would leave.
 */

import { describe, expect, it } from 'vitest';

import {
  MaskEffect,
  MaskWeights,
  NO_FEATHER,
  type SpectralMask,
  type SpectralShape,
} from '@audiogubbins/domain';
import type { FieldBatch, RenderBatch, RenderFrame, SegmentBatch } from '@audiogubbins/renderer';
import {
  EMPTY_SELECTION,
  SpectralCombination,
  pixelOf,
  samplesPerPixel,
  viewportAtStart,
  withSpectralMask,
  withTimeRange,
  type SelectionSet,
} from '@audiogubbins/timeline';

import { FrameComposer, type ViewContent } from './frame-composer.js';
import { frequencyAt, frequencyY } from './frequency-axis.js';
import type { Lane } from './lane-layout.js';
import { withDrawnShape } from './spectral-tools.js';
import { PALETTE, at, scene } from './testing/scene.js';
import { DisplayMode, type EditorViewState } from './view-state.js';

const RECTANGLE: SpectralShape = {
  kind: 'rectangle',
  effect: MaskEffect.Add,
  range: { start: at(20_000), end: at(40_000) },
  band: { low: 200, high: 2_000 },
};

const SOFT: SpectralMask = { shapes: [RECTANGLE], feather: { time: 3_000, frequency: 150 } };

const STROKE: SpectralShape = {
  kind: 'stroke',
  effect: MaskEffect.Add,
  hardness: 0.3,
  points: [
    {
      position: at(60_000),
      frequency: 500,
      strength: 0.8,
      radius: { time: 2_000, frequency: 200 },
    },
    {
      position: at(70_000),
      frequency: 900,
      strength: 0.4,
      radius: { time: 2_000, frequency: 300 },
    },
  ],
};

function mask(...shapes: readonly [SpectralShape, ...SpectralShape[]]): SpectralMask {
  return { shapes, feather: NO_FEATHER };
}

function spectrogram(state: EditorViewState): EditorViewState {
  return { ...state, displayMode: DisplayMode.Spectrogram };
}

function compose(
  selection: SelectionSet,
  options: Parameters<typeof scene>[0] = {},
  composer = new FrameComposer(),
): RenderFrame {
  return composer.compose(scene({ state: spectrogram, selection, ...options }));
}

function fields(frame: RenderFrame, lane = 0): FieldBatch[] {
  return (frame.layers[lane]?.batches ?? []).filter(
    (batch): batch is FieldBatch => batch.kind === 'field',
  );
}

function onlyField(frame: RenderFrame, lane = 0): FieldBatch {
  const [field, ...others] = fields(frame, lane);
  expect(others).toEqual([]);
  if (field === undefined) throw new Error('No field drawn.');
  return field;
}

function segmentsIn(batches: readonly RenderBatch[], colour: readonly number[]): number {
  return batches
    .filter((batch): batch is SegmentBatch => batch.kind === 'segments')
    .filter((batch) => batch.colour === colour)
    .reduce((sum, batch) => sum + batch.count, 0);
}

/** The first lane of the test scene, a spectrogram. */
function firstLane(frame: RenderFrame): Lane {
  const clip = frame.layers[0]?.clip;
  if (clip === undefined) throw new Error('No lane.');
  return { channel: 0, kind: 'spectrogram', area: clip };
}

describe('the spectral selection’s weight', () => {
  it('is the domain’s weight of the mask at the centre of each device pixel it reaches', () => {
    for (const pixelRatio of [1, 2]) {
      const selection = withSpectralMask(EMPTY_SELECTION, SOFT);
      const frame = compose(selection, { pixelRatio });
      const batch = onlyField(frame);
      const lane = firstLane(frame);
      const state = spectrogram(scene({}).state);
      const weights = new MaskWeights(SOFT);
      const { width, height, values } = batch.field;
      const left = batch.at.x * pixelRatio;
      const top = batch.at.y * pixelRatio;
      expect(batch.columns).toEqual({ from: 0, to: width });
      expect(Array.from(batch.rows)).toEqual(Array.from({ length: height }, (_, row) => row));
      for (let column = 0; column < width; column += 7) {
        const x = (left + column + 0.5) / pixelRatio;
        // A hundred samples a pixel in the test scene's view of 100,000 in 1,000.
        const position = x * 100;
        for (let row = 0; row < height; row += 5) {
          const frequency = frequencyAt(lane, (top + row + 0.5) / pixelRatio, state.spectral);
          expect(values[row * width + column]).toBe(
            Math.round(weights.at(position, frequency) * 255),
          );
        }
      }
    }
  });

  it('is drawn over the device pixels its support reaches, and no further', () => {
    const frame = compose(withSpectralMask(EMPTY_SELECTION, mask(RECTANGLE)));
    const batch = onlyField(frame);
    const lane = firstLane(frame);
    const state = spectrogram(scene({}).state);
    expect(batch.at.x).toBe(Math.floor(pixelOf(state.viewport, 20_000)));
    expect(batch.at.x + batch.at.width).toBe(Math.ceil(pixelOf(state.viewport, 40_000)));
    expect(batch.at.y).toBe(Math.floor(frequencyY(lane, 2_000, state.spectral)));
    expect(batch.at.y + batch.at.height).toBe(Math.ceil(frequencyY(lane, 200, state.spectral)));
    const { width, height, values } = batch.field;
    // Inside the rectangle the weight is full.
    expect(values[Math.floor(height / 2) * width + Math.floor(width / 2)]).toBe(255);
  });

  it('weighs a stroke as it softens by its own hardness and strength', () => {
    const frame = compose(withSpectralMask(EMPTY_SELECTION, mask(STROKE)));
    const values = Array.from(onlyField(frame).field.values);
    expect(Math.max(...values)).toBe(Math.round(0.8 * 255));
    expect(values.some((value) => value > 0 && value < 0.4 * 255)).toBe(true);
  });

  it('draws in the selection’s colour while active and quieter while another facet is', () => {
    const active = onlyField(compose(withSpectralMask(EMPTY_SELECTION, mask(RECTANGLE))));
    const kept = onlyField(
      compose(
        withTimeRange(withSpectralMask(EMPTY_SELECTION, mask(RECTANGLE)), {
          start: at(0),
          end: at(10),
        }),
      ),
    );
    const [red, green, blue, alpha] = PALETTE.selectionFill;
    expect(Array.from(active.ramp.colours.subarray(255 * 4))).toEqual([
      Math.round(red * 255),
      Math.round(green * 255),
      Math.round(blue * 255),
      Math.round(alpha * 255),
    ]);
    expect(Array.from(active.ramp.colours.subarray(0, 4))).toEqual([
      Math.round(red * 255),
      Math.round(green * 255),
      Math.round(blue * 255),
      0,
    ]);
    expect(kept.ramp.key).not.toBe(active.ramp.key);
    expect(kept.ramp.colours[0]).toBe(Math.round(PALETTE.inactiveSelectionFill[0] * 255));
  });

  it('is drawn on no waveform lane', () => {
    const frame = compose(withSpectralMask(EMPTY_SELECTION, mask(RECTANGLE)), {
      state: (state) => state,
    });
    expect(fields(frame)).toEqual([]);
  });

  it('is kept, under its key, while nothing it is drawn from changes, and made again when it does', () => {
    const composer = new FrameComposer();
    const selection = withSpectralMask(EMPTY_SELECTION, mask(RECTANGLE));
    const first = onlyField(compose(selection, {}, composer));
    const again = onlyField(compose(selection, {}, composer));
    expect(again.field).toBe(first.field);
    const scrolled = onlyField(
      compose(
        selection,
        {
          state: (state) =>
            spectrogram({ ...state, viewport: { ...state.viewport, start: at(1_000) } }),
        },
        composer,
      ),
    );
    expect(scrolled.field.key).not.toBe(first.field.key);
    expect(scrolled.at.x).toBeLessThan(first.at.x);
  });

  it('is the same after the composer and the renderer are made again', () => {
    const selection = withSpectralMask(EMPTY_SELECTION, SOFT);
    const one = onlyField(compose(selection));
    const other = onlyField(compose(selection));
    expect(other.at).toEqual(one.at);
    expect(Array.from(other.field.values)).toEqual(Array.from(one.field.values));
  });

  it('stays on what it selects at every zoom', () => {
    const selection = withSpectralMask(EMPTY_SELECTION, mask(RECTANGLE));
    for (const samples of [100, 37, 25]) {
      const frame = compose(selection, {
        state: (state) =>
          spectrogram({ ...state, viewport: viewportAtStart(samplesPerPixel(samples), 1000) }),
      });
      const batch = onlyField(frame);
      expect(batch.at.x).toBe(Math.floor(20_000 / samples));
      expect(batch.at.x + batch.at.width).toBe(Math.min(1000, Math.ceil(40_000 / samples)));
    }
  });
});

describe('a spectral drag in progress', () => {
  it('draws the selection its shape would leave in place of the selection', () => {
    const selection = withSpectralMask(EMPTY_SELECTION, mask(RECTANGLE));
    const drawn = {
      shape: STROKE,
      combination: SpectralCombination.Add,
      feather: NO_FEATHER,
      channels: undefined,
    };
    const frame = compose(selection, {
      preview: {
        kind: 'spectral-shape',
        drawn,
        selection: withDrawnShape(selection, drawn, 2),
      },
    });
    // The rectangle's four edges and the stroke's one step.
    expect(segmentsIn(frame.layers[0]?.batches ?? [], PALETTE.selectionBorder)).toBe(5);
    expect(onlyField(frame).at.x + onlyField(frame).at.width).toBeGreaterThan(
      pixelOf(scene({}).state.viewport, 70_000),
    );
  });
});

describe('the outlines of spectral edits', () => {
  const content = (spectralEdits: ViewContent['spectralEdits']): ViewContent => ({
    length: at(100_000),
    channelNames: ['L', 'R'],
    markers: [],
    regions: [],
    spectralEdits,
  });

  it('are drawn in their own colour, each shape as it was drawn, on the lanes of their channels', () => {
    const frame = compose(EMPTY_SELECTION, {
      content: content([
        { mask: mask(RECTANGLE, STROKE), from: 0 },
        { mask: mask(RECTANGLE), from: 0, channels: [1] },
      ]),
    });
    expect(segmentsIn(frame.layers[0]?.batches ?? [], PALETTE.spectralEdit)).toBe(5);
    expect(segmentsIn(frame.layers[1]?.batches ?? [], PALETTE.spectralEdit)).toBe(9);
    expect(fields(frame)).toEqual([]);
  });

  it('are placed from where each edit begins on the view’s timeline', () => {
    const frame = compose(EMPTY_SELECTION, {
      content: content([{ mask: mask(RECTANGLE), from: -5_000 }]),
    });
    const [edges] = (frame.layers[0]?.batches ?? []).filter(
      (batch): batch is SegmentBatch =>
        batch.kind === 'segments' && batch.colour === PALETTE.spectralEdit,
    );
    const viewport = spectrogram(scene({}).state).viewport;
    expect(edges?.values[0]).toBe(Math.fround(pixelOf(viewport, 15_000)));
    expect(edges?.values[2]).toBe(Math.fround(pixelOf(viewport, 35_000)));
  });

  it('are drawn beneath the selection', () => {
    const frame = compose(withSpectralMask(EMPTY_SELECTION, mask(RECTANGLE)), {
      content: content([{ mask: mask(RECTANGLE), from: 0 }]),
    });
    const kinds = (frame.layers[0]?.batches ?? []).map((batch) =>
      batch.kind === 'segments' && batch.colour === PALETTE.spectralEdit
        ? 'edit'
        : batch.kind === 'field'
          ? 'selection'
          : undefined,
    );
    expect(kinds.indexOf('edit')).toBeLessThan(kinds.indexOf('selection'));
  });

  it('are not drawn where the view’s overlays leave them out, nor on a waveform lane', () => {
    const edits = content([{ mask: mask(RECTANGLE), from: 0 }]);
    const off = compose(EMPTY_SELECTION, {
      content: edits,
      state: (state) =>
        spectrogram({ ...state, overlays: { ...state.overlays, spectralEdits: false } }),
    });
    expect(segmentsIn(off.layers[0]?.batches ?? [], PALETTE.spectralEdit)).toBe(0);
    const waveform = compose(EMPTY_SELECTION, { content: edits, state: (state) => state });
    expect(segmentsIn(waveform.layers[0]?.batches ?? [], PALETTE.spectralEdit)).toBe(0);
  });
});
