/**
 * The spectral tools drawn from the keyboard (REQ-UX-005, ADR-0082): a cursor
 * in a spectrogram lane, whose time is the playhead and whose height a key
 * moves a step of the frequency axis at a time, and the points a key places
 * where it is, which a marquee takes as a corner, a lasso as a corner of its
 * polygon and a brush as a dab of its stroke.
 *
 * What the points make is what a pointer pressed at the first, dragged through
 * the rest and let go at the cursor makes: each is read as the pointer's
 * reading at that boundary and height in the lane, through the tools' own trail
 * and shape (`spectral-tools.ts`), at the fixed strength, since a key has no
 * pressure, and joined by the combination mode, since a key holds no modifier.
 * So the keyboard reaches every spectral selection a pointer makes, and the
 * selection command takes it as it takes a drag's.
 *
 * The cursor's height is kept as a whole number of fine steps up the axis
 * rather than in hertz, as a pointer's is a height in the lane, so the
 * frequency of a point is read from the lane exactly as a pointer's would be,
 * and a cursor stepped up and back down is where it was. Nothing here changes
 * the selection or the view: the drawing is a value the view's store keeps.
 */

import type { SampleCount } from '@audiogubbins/domain';
import { pixelOf, type SelectionSet } from '@audiogubbins/timeline';

import { frequencyAt } from './frequency-axis.js';
import { LaneKind, type Lane, type ViewLayout } from './lane-layout.js';
import { draggedChannels } from './pointer-tools.js';
import {
  drawnShapeOf,
  startedTrail,
  tracedTrail,
  withDrawnShape,
  type DrawnShape,
  type SpectralReading,
  type SpectralToolContext,
  type SpectralToolId,
} from './spectral-tools.js';
import { FREQUENCY_STEP_SHARE } from './spectral-steps.js';

/** How many fine steps a step of the cursor is. */
const FINE_STEPS = 10;

/**
 * How many fine steps the axis is from its foot to its top: a step of the
 * cursor moves it as far as a step of a selection's band.
 */
const CURSOR_RUNGS = Math.round(FINE_STEPS / FREQUENCY_STEP_SHARE);

/** A point of a keyboard drawing: a boundary, and a height in fine steps up the axis from its foot. */
export interface DrawingPoint {
  readonly position: SampleCount;
  readonly rung: number;
}

/**
 * A spectral shape being drawn from the keyboard: the channel whose lane it
 * is drawn in, the cursor's height there, and the points placed so far, in
 * the order placed.
 */
export interface KeyboardDrawing {
  readonly channel: number;
  /** The cursor's height, in fine steps up the axis from its foot. */
  readonly rung: number;
  readonly placed: readonly DrawingPoint[];
}

/** A drawing that has placed nothing, its cursor half way up the lane of `channel`. */
export function newDrawing(channel: number): KeyboardDrawing {
  return { channel, rung: CURSOR_RUNGS / 2, placed: [] };
}

/** How the cursor moves: a step up or down the axis, or a tenth of one. */
export const CursorStep = {
  Up: 'up',
  Down: 'down',
  FineUp: 'fine-up',
  FineDown: 'fine-down',
} as const;

export type CursorStep = (typeof CursorStep)[keyof typeof CursorStep];

const STEP_RUNGS: Readonly<Record<CursorStep, number>> = {
  [CursorStep.Up]: FINE_STEPS,
  [CursorStep.Down]: -FINE_STEPS,
  [CursorStep.FineUp]: 1,
  [CursorStep.FineDown]: -1,
};

/** `drawing` with its cursor moved by `step`, within the lane; itself at the edge. */
export function cursorStepped(drawing: KeyboardDrawing, step: CursorStep): KeyboardDrawing {
  const rung = Math.min(CURSOR_RUNGS, Math.max(0, drawing.rung + STEP_RUNGS[step]));
  return rung === drawing.rung ? drawing : { ...drawing, rung };
}

/** `drawing` with a point placed at the cursor, at boundary `position`. */
export function pointPlaced(drawing: KeyboardDrawing, position: SampleCount): KeyboardDrawing {
  return { ...drawing, placed: [...drawing.placed, { position, rung: drawing.rung }] };
}

/** The lane a drawing on `channel` is read against: the channel's spectrogram, if it shows one. */
export function drawingLaneOf(layout: ViewLayout, channel: number): Lane | undefined {
  return layout.lanes.find((lane) => lane.channel === channel && lane.kind !== LaneKind.Waveform);
}

/** What a keyboard drawing is read with. */
export interface DrawingContext {
  readonly tool: SpectralToolId;
  /** What the tool reads, its lane the drawing channel's spectrogram lane. */
  readonly spectral: SpectralToolContext & { readonly lane: Lane };
  /** The channels the view shows, as a pointer's press reads them. */
  readonly visibleChannels: readonly number[];
  /** The cursor's boundary: the playhead. */
  readonly position: SampleCount;
  /** The fixed strength, which every point is drawn at. */
  readonly strength: number;
}

/** Where a pointer at `point` in `lane` would be, as a spectral tool reads it. */
function readingAt(
  { spectral, strength }: DrawingContext,
  point: DrawingPoint,
): SpectralReading & { readonly shift: false; readonly alt: false } {
  const { area } = spectral.lane;
  return {
    x: area.x + pixelOf(spectral.viewport, point.position),
    y: area.y + area.height * (1 - point.rung / CURSOR_RUNGS),
    boundary: point.position,
    strength,
    shift: false,
    alt: false,
  };
}

/** The frequency under the cursor of `drawing`, as a pointer there would name it. */
export function cursorFrequency(drawing: KeyboardDrawing, context: DrawingContext): number {
  const { lane, axis } = context.spectral;
  return frequencyAt(lane, readingAt(context, cursorOf(drawing, context)).y, axis);
}

/** The cursor of `drawing`, as a point. */
function cursorOf(drawing: KeyboardDrawing, context: DrawingContext): DrawingPoint {
  return { position: context.position, rung: drawing.rung };
}

/**
 * The shape `drawing` makes let go at its cursor, and how it joins the
 * selection, or none where it makes nothing a selection can hold: the shape
 * a pointer pressed at its first point, moved through the rest and released
 * at the cursor draws.
 */
export function drawingShape(
  drawing: KeyboardDrawing,
  context: DrawingContext,
): DrawnShape | undefined {
  const [first, ...rest] = drawing.placed;
  if (first === undefined) return undefined;
  const { tool, spectral } = context;
  const start = readingAt(context, first);
  let trail = startedTrail(tool, spectral, start);
  for (const point of rest) {
    trail = tracedTrail(trail, tool, spectral, readingAt(context, point), false);
  }
  const release = readingAt(context, cursorOf(drawing, context));
  trail = tracedTrail(trail, tool, spectral, release, true);
  const channels = draggedChannels(context.visibleChannels, drawing.channel, drawing.channel);
  return drawnShapeOf({ tool, spectral, start, trail, channels }, release);
}

/** A point of a keyboard drawing where it is drawn, in CSS pixels. */
export interface DrawnPoint {
  readonly x: number;
  readonly y: number;
}

/** What a view draws of a keyboard drawing in its lane: the points placed and the cursor. */
export interface DrawingMarks {
  readonly channel: number;
  readonly points: readonly DrawnPoint[];
  readonly cursor: DrawnPoint;
}

/** What a view shows of `drawing`: its marks, and the selection its shape, let go now, would leave. */
export function drawingPreview(
  drawing: KeyboardDrawing,
  context: DrawingContext,
): {
  readonly marks: DrawingMarks;
  readonly drawn: DrawnShape | undefined;
  readonly selection: SelectionSet | undefined;
} {
  const at = (point: DrawingPoint): DrawnPoint => {
    const { x, y } = readingAt(context, point);
    return { x, y };
  };
  const drawn = drawingShape(drawing, context);
  const { spectral } = context;
  return {
    marks: {
      channel: drawing.channel,
      points: drawing.placed.map(at),
      cursor: at(cursorOf(drawing, context)),
    },
    drawn,
    selection:
      drawn === undefined
        ? undefined
        : withDrawnShape(spectral.selection, drawn, spectral.channelCount),
  };
}
