/**
 * The spectral tools drawn from the keyboard (ADR-0082): the shape a cursor's
 * points make is the shape a pointer pressed at the first, dragged through the
 * rest and let go at the cursor makes, for the marquee, the lasso and the
 * brush, joined as the combination mode says and at the fixed strength.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_GESTURE_SETTINGS, PointerKind } from '@audiogubbins/input';
import {
  EMPTY_SELECTION,
  SpectralCombination,
  pixelOf,
  samplesPerPixel,
  viewportAtStart,
} from '@audiogubbins/timeline';

import { frequencyAt } from './frequency-axis.js';
import {
  CursorStep,
  cursorFrequency,
  cursorStepped,
  drawingPreview,
  drawingShape,
  newDrawing,
  pointPlaced,
  type DrawingContext,
  type DrawingPoint,
  type KeyboardDrawing,
} from './keyboard-drawing.js';
import { LaneKind, type Lane } from './lane-layout.js';
import { move, press, release } from './pointer-tools.js';
import type { SpectralToolId } from './spectral-tools.js';
import { at } from './testing/scene.js';
import type { ToolContext, ToolInput, ToolIntent } from './tool-values.js';
import { ToolId, newViewState, type SpectralToolSettings } from './view-state.js';

const LANE: Lane = {
  channel: 1,
  kind: LaneKind.Spectrogram,
  area: { x: 0, y: 250, width: 1000, height: 200 },
};
const VIEW = viewportAtStart(samplesPerPixel(10), 1000);
const AXIS = { frequencyScale: 'logarithmic', lowest: 20, highest: 20_000 } as const;
const TOOLS = newViewState(at(0), 0).spectralTools;
const STRENGTH = DEFAULT_GESTURE_SETTINGS.fixedStrength;
/** How many fine steps the cursor's axis is from its foot to its top. */
const RUNGS = 200;

function spectralOf(settings: SpectralToolSettings) {
  return {
    lane: LANE,
    axis: AXIS,
    viewport: VIEW,
    length: at(1_000_000),
    channelCount: 2,
    selection: EMPTY_SELECTION,
    settings,
  };
}

function drawingContext(
  tool: SpectralToolId,
  position: number,
  settings: SpectralToolSettings = TOOLS,
): DrawingContext {
  return {
    tool,
    spectral: spectralOf(settings),
    visibleChannels: [0, 1],
    position: at(position),
    strength: STRENGTH,
  };
}

/** The drawing that placed `points` on channel 1, its cursor at the last one's height. */
function drawingOf(points: readonly DrawingPoint[]): KeyboardDrawing {
  let drawing = newDrawing(1);
  for (const point of points)
    drawing = pointPlaced({ ...drawing, rung: point.rung }, point.position);
  return drawing;
}

/** A mouse where a point is, as the application reads one: no modifier, the fixed strength. */
function mouseAt(point: DrawingPoint): ToolInput {
  return {
    x: pixelOf(VIEW, point.position),
    y: LANE.area.y + LANE.area.height * (1 - point.rung / RUNGS),
    pointer: PointerKind.Mouse,
    boundary: point.position,
    channel: 1,
    shift: false,
    alt: false,
    strength: STRENGTH,
  };
}

/** What a mouse pressed at the first point, dragged through the rest and let go at the last makes. */
function dragged(
  tool: SpectralToolId,
  points: readonly DrawingPoint[],
  settings: SpectralToolSettings = TOOLS,
): readonly ToolIntent[] {
  const context: ToolContext = {
    tool,
    panning: false,
    hit: { kind: 'lane', lane: LANE },
    selection: undefined,
    visibleChannels: [0, 1],
    spectral: spectralOf(settings),
  };
  const [first, ...rest] = points.map(mouseAt);
  if (first === undefined) throw new Error('No points.');
  let step = press(context, first);
  for (const input of rest) step = move(step.interaction, input);
  return release(step.interaction, rest.at(-1) ?? first).intents;
}

const POINTS: readonly DrawingPoint[] = [
  { position: at(1_000), rung: 160 },
  { position: at(1_020), rung: 158 },
  { position: at(2_500), rung: 140 },
  { position: at(3_000), rung: 60 },
  { position: at(1_200), rung: 50 },
];

describe('a spectral shape drawn from the keyboard', () => {
  for (const tool of [ToolId.SpectralLasso, ToolId.SpectralBrush] as const) {
    it(`makes with the ${tool} the shape a pointer drawing those points makes`, () => {
      const last = POINTS.at(-1);
      if (last === undefined) throw new Error('No points.');
      const drawn = drawingShape(drawingOf(POINTS), drawingContext(tool, last.position));
      expect(drawn).toBeDefined();
      expect(dragged(tool, POINTS)).toEqual([{ kind: 'select-spectral', drawn }]);
    });
  }

  it('makes with the marquee the rectangle from its corner to the cursor', () => {
    const corner = { position: at(1_000), rung: 160 };
    const cursor = { position: at(4_000), rung: 60 };
    const drawn = drawingShape(
      { ...drawingOf([corner]), rung: cursor.rung },
      drawingContext(ToolId.SpectralMarquee, cursor.position),
    );
    expect(drawn?.shape.kind).toBe('rectangle');
    expect(dragged(ToolId.SpectralMarquee, [corner, cursor])).toEqual([
      { kind: 'select-spectral', drawn },
    ]);
  });

  it('lets go at the cursor, which a pointer let go there takes as its last point', () => {
    const cursor = { position: at(5_000), rung: 100 };
    const drawn = drawingShape(
      { ...drawingOf(POINTS.slice(0, 3)), rung: cursor.rung },
      drawingContext(ToolId.SpectralLasso, cursor.position),
    );
    expect(dragged(ToolId.SpectralLasso, [...POINTS.slice(0, 3), cursor])).toEqual([
      { kind: 'select-spectral', drawn },
    ]);
  });

  it('joins the selection as the combination mode says, and strokes at the fixed strength', () => {
    const settings = { ...TOOLS, combination: SpectralCombination.Subtract };
    const last = POINTS.at(-1);
    if (last === undefined) throw new Error('No points.');
    const drawn = drawingShape(
      drawingOf(POINTS),
      drawingContext(ToolId.SpectralBrush, last.position, settings),
    );
    expect(drawn?.combination).toBe(SpectralCombination.Subtract);
    expect(drawn?.channels).toEqual([1]);
    expect(
      drawn?.shape.kind === 'stroke' && drawn.shape.points.map((point) => point.strength),
    ).toEqual(drawn?.shape.kind === 'stroke' ? drawn.shape.points.map(() => STRENGTH) : []);
  });

  it('makes nothing before a point is placed, nor a polygon of fewer than three', () => {
    expect(drawingShape(newDrawing(1), drawingContext(ToolId.SpectralBrush, 0))).toBeUndefined();
    expect(
      drawingShape(drawingOf(POINTS.slice(0, 1)), drawingContext(ToolId.SpectralLasso, 1_000)),
    ).toBeUndefined();
  });

  it('shows its points, the cursor, and the selection its shape would leave', () => {
    const last = POINTS.at(-1);
    if (last === undefined) throw new Error('No points.');
    const preview = drawingPreview(
      drawingOf(POINTS),
      drawingContext(ToolId.SpectralLasso, last.position),
    );
    expect(preview.marks.points).toEqual(
      POINTS.map((point) => ({ x: mouseAt(point).x, y: mouseAt(point).y })),
    );
    expect(preview.marks.cursor).toEqual({ x: mouseAt(last).x, y: mouseAt(last).y });
    expect(preview.selection?.spectral?.shapes).toHaveLength(1);
  });
});

describe('the keyboard cursor', () => {
  it('moves a twentieth of the axis, or a tenth of that, and stops at the lane’s edges', () => {
    const drawing = newDrawing(0);
    expect(drawing.rung).toBe(100);
    expect(cursorStepped(drawing, CursorStep.Up).rung).toBe(110);
    expect(cursorStepped(drawing, CursorStep.FineDown).rung).toBe(99);
    const top = { ...drawing, rung: RUNGS };
    expect(cursorStepped(top, CursorStep.Up)).toBe(top);
    expect(cursorStepped({ ...drawing, rung: 3 }, CursorStep.Down).rung).toBe(0);
  });

  it('names the frequency a pointer at its height would', () => {
    const drawing = { ...newDrawing(1), rung: 150 };
    const context = drawingContext(ToolId.SpectralLasso, 2_000);
    expect(cursorFrequency(drawing, context)).toBe(
      frequencyAt(LANE, mouseAt({ position: at(2_000), rung: 150 }).y, AXIS),
    );
  });
});
