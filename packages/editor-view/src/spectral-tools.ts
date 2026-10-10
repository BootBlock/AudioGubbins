/**
 * What the spectral marquee, the spectral lasso and the spectral brush draw
 * (REQ-EDIT-065, ADR-0082): a shape of the domain's mask, read from a drag
 * over a spectrogram lane, and how it joins the spectral selection.
 *
 * Every point is read against the lane the press began in: its position is
 * the boundary under the pointer, snapped as the view says, and its frequency
 * the inverse of the lane's frequency mapping at the pointer's height, so a
 * shape lands on what was under the pointer at any zoom and on either scale.
 * A brush's radius is set in CSS pixels and converted at each point to
 * samples and to hertz through the same mappings, so a stroke drawn on a
 * logarithmic axis keeps the shape it was drawn with. Its strength is the
 * pointer's, which the input model's `toolStrength` gives: a pen's pressure
 * where the person allows it, the fixed strength otherwise, so a stroke drawn
 * at the fixed strength is the same mask on any hardware.
 *
 * Nothing here changes the selection. A drag's shape becomes an intent the
 * application runs as a selection command, and `withDrawnShape` is the one
 * account of what that command makes of it, which the preview of the drag
 * shows before it is let go.
 */

import {
  HIGHEST_MASK_FREQUENCY,
  MAXIMUM_MASK_POINTS,
  MaskEffect,
  NO_FEATHER,
  type SampleCount,
  type SpectralFeather,
  type SpectralPoint,
  type SpectralShape,
  type StrokePoint,
} from '@audiogubbins/domain';
import {
  SpectralCombination,
  samplesWithin,
  withChannels,
  withSpectralShape,
  type SelectionSet,
  type ViewportState,
} from '@audiogubbins/timeline';

import { frequencyAt, frequencyOnAxis } from './frequency-axis.js';
import { LaneKind, type Lane } from './lane-layout.js';
import { ToolId, type SpectralSettings } from './view-state.js';

/** How the spectral tools draw, which the person sets in the Spectral panel. */
export interface SpectralToolSettings {
  /** The brush's radius in CSS pixels. */
  readonly brushRadius: number;
  /** How much of the brush's radius is at full strength, from 0 to just below 1. */
  readonly hardness: number;
  /** How far past their edges the marquee's and the lasso's shapes fade out. */
  readonly feather: SpectralFeather;
}

/** How the spectral tools draw before the person changes anything. */
export const DEFAULT_SPECTRAL_TOOL_SETTINGS: SpectralToolSettings = {
  brushRadius: 12,
  hardness: 0.5,
  feather: NO_FEATHER,
};

/** What a spectral tool reads of the view and the selection at a press. */
export interface SpectralToolContext {
  /** The lane under the press, which every point of the drag is read against. */
  readonly lane: Lane | undefined;
  readonly axis: SpectralSettings;
  readonly viewport: ViewportState;
  /** The asset's length, which a brush's reach in time stays within. */
  readonly length: SampleCount;
  readonly channelCount: number;
  /** The asset's selection, which a drawn shape joins. */
  readonly selection: SelectionSet;
  readonly settings: SpectralToolSettings;
}

/**
 * A shape a spectral tool drew, and how it joins the spectral selection: it
 * replaces it, adds to it (Shift) or takes from it (Alt). The shape is as
 * drawn, adding, and the combination says what it does. A shape that
 * replaces the selection scopes it to `channels`, every channel where they
 * are absent, as a drag of the time-selection tool does; one that joins the
 * selection keeps its scope.
 */
export interface DrawnShape {
  readonly shape: SpectralShape;
  readonly combination: SpectralCombination;
  readonly feather: SpectralFeather;
  readonly channels: readonly number[] | undefined;
}

/**
 * `set` with `drawn` joined to its spectral selection, for an asset of
 * `channelCount` channels: what the selection command makes of a spectral
 * tool's intent, and what the drag's preview shows.
 */
export function withDrawnShape(
  set: SelectionSet,
  drawn: DrawnShape,
  channelCount: number,
): SelectionSet {
  const joined = withSpectralShape(set, drawn.shape, drawn.combination, drawn.feather);
  return drawn.combination === SpectralCombination.Replace && joined !== set
    ? withChannels(joined, drawn.channels ?? [], channelCount)
    : joined;
}

/** A spectral tool. */
export type SpectralToolId =
  typeof ToolId.SpectralMarquee | typeof ToolId.SpectralLasso | typeof ToolId.SpectralBrush;

/** Whether `tool` is a spectral tool. */
export function isSpectralTool(tool: ToolId): tool is SpectralToolId {
  return (
    tool === ToolId.SpectralMarquee ||
    tool === ToolId.SpectralLasso ||
    tool === ToolId.SpectralBrush
  );
}

/** Whether a lane shows a spectrogram a spectral tool can draw on. */
export function showsSpectrogram(lane: Lane | undefined): lane is Lane {
  return lane !== undefined && lane.kind !== LaneKind.Waveform;
}

/** How the modifiers held at a press join its shape: Alt takes away, Shift adds. */
function combinationOf(modifiers: {
  readonly shift: boolean;
  readonly alt: boolean;
}): SpectralCombination {
  if (modifiers.alt) return SpectralCombination.Subtract;
  return modifiers.shift ? SpectralCombination.Add : SpectralCombination.Replace;
}

/** A point of a drag where the pointer was, in CSS pixels, and in time and frequency. */
export interface Trace {
  readonly x: number;
  readonly y: number;
  readonly point: StrokePoint;
}

/** Where the pointer is, as a spectral tool reads it. */
export interface SpectralReading {
  readonly x: number;
  readonly y: number;
  readonly boundary: SampleCount;
  readonly strength: number;
}

/**
 * The lightest a brush marks: a pen touching at no pressure still marks, at
 * the least strength a mask holds above nothing (ADR-0081), rather than
 * making a point the selection would refuse.
 */
const LIGHTEST_STROKE = 1 / 256;

/** The fewest CSS pixels between two points a lasso keeps. */
const LASSO_SPACING = 3;

/**
 * The trace of `reading` against `lane`: its position, its frequency, and a
 * brush's strength and its radius converted there.
 */
function traceOf(context: SpectralToolContext, lane: Lane, reading: SpectralReading): Trace {
  const { axis, viewport, settings } = context;
  const radius = settings.brushRadius;
  const reach =
    (frequencyOnAxis(lane, reading.y - radius, axis) -
      frequencyOnAxis(lane, reading.y + radius, axis)) /
    2;
  return {
    x: reading.x,
    y: reading.y,
    point: {
      position: reading.boundary,
      frequency: frequencyAt(lane, reading.y, axis),
      strength: Math.min(1, Math.max(LIGHTEST_STROKE, reading.strength)),
      radius: {
        time: Math.min(samplesWithin(viewport, radius), context.length + 1),
        frequency: Math.min(HIGHEST_MASK_FREQUENCY, reach),
      },
    },
  };
}

/**
 * The traces of a drag, appended to as it moves: a value, as an interaction
 * is, which shares its array with the trail it was appended to while that
 * trail is not appended to again, so a drag of any length copies nothing.
 */
export class Trail {
  readonly #traces: Trace[];
  readonly length: number;
  /** The last trace. */
  readonly last: Trace;

  private constructor(traces: Trace[], last: Trace) {
    this.#traces = traces;
    this.length = traces.length;
    this.last = last;
  }

  /** A trail that starts at `first`. */
  static from(first: Trace): Trail {
    return new Trail([first], first);
  }

  /** This trail with `trace` after its last. */
  appended(trace: Trace): Trail {
    // Appended to before, the array holds traces past this trail's end, which
    // belong to the other trail: this one takes a copy of its own.
    const traces =
      this.#traces.length === this.length ? this.#traces : this.#traces.slice(0, this.length);
    traces.push(trace);
    return new Trail(traces, trace);
  }

  /** The traces, first to last. */
  traces(): readonly Trace[] {
    return this.#traces.slice(0, this.length);
  }
}

/** How far apart, in CSS pixels, the points of a drag with `tool` are kept. */
function spacingOf(tool: ToolId, settings: SpectralToolSettings): number {
  return tool === ToolId.SpectralLasso ? LASSO_SPACING : Math.max(1, settings.brushRadius / 4);
}

/**
 * `trail` with `trace` appended where it lies at least `tool`'s spacing from
 * the last, or, at a release, `final`, anywhere but on it. A trail holds no
 * more points than a mask may, so a shape the tool makes is one a selection
 * can take; the drag goes on, its shape ending where the trail did.
 */
function extendedTrail(
  trail: Trail,
  trace: Trace,
  tool: ToolId,
  settings: SpectralToolSettings,
  final: boolean,
): Trail {
  if (trail.length >= MAXIMUM_MASK_POINTS) return trail;
  const { last } = trail;
  const distance = Math.hypot(trace.x - last.x, trace.y - last.y);
  const spacing = final ? Number.MIN_VALUE : spacingOf(tool, settings);
  return distance >= spacing ? trail.appended(trace) : trail;
}

/** Twice the area the traces enclose, in square CSS pixels, by the shoelace rule. */
function enclosed(traces: readonly Trace[]): number {
  let sum = 0;
  for (let index = 0; index < traces.length; index += 1) {
    const a = traces[index];
    const b = traces[(index + 1) % traces.length];
    if (a === undefined || b === undefined) continue;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum);
}

function spectralPoint({ point }: Trace): SpectralPoint {
  return { position: point.position, frequency: point.frequency };
}

/**
 * The rectangle a marquee drawn from `from` to `to` spans: its range and
 * band, or none where it is no wider or taller than a point.
 */
function marqueeShape(from: Trace, to: Trace): SpectralShape | undefined {
  const [start, end] =
    from.point.position <= to.point.position
      ? [from.point.position, to.point.position]
      : [to.point.position, from.point.position];
  const low = Math.min(from.point.frequency, to.point.frequency);
  const high = Math.max(from.point.frequency, to.point.frequency);
  if (start === end || low === high) return undefined;
  return { kind: 'rectangle', effect: MaskEffect.Add, range: { start, end }, band: { low, high } };
}

/**
 * The polygon a lasso's traces enclose, the last joined to the first, or none
 * where they enclose less than a square pixel, a line selecting nothing.
 */
function lassoShape(traces: readonly Trace[]): SpectralShape | undefined {
  const [a, b, c, ...rest] = traces;
  if (a === undefined || b === undefined || c === undefined || enclosed(traces) < 2) {
    return undefined;
  }
  return {
    kind: 'polygon',
    effect: MaskEffect.Add,
    points: [spectralPoint(a), spectralPoint(b), spectralPoint(c), ...rest.map(spectralPoint)],
  };
}

/** The stroke a brush's traces make, a single dab where it was not dragged. */
function brushShape(
  traces: readonly Trace[],
  settings: SpectralToolSettings,
): SpectralShape | undefined {
  const [first, ...rest] = traces;
  if (first === undefined) return undefined;
  return {
    kind: 'stroke',
    effect: MaskEffect.Add,
    hardness: settings.hardness,
    points: [first.point, ...rest.map((trace) => trace.point)],
  };
}

/** Where a spectral tool's drag reads from: its press, and the trail it has traced. */
export interface SpectralDrag {
  readonly tool: ToolId;
  readonly spectral: SpectralToolContext;
  readonly start: SpectralReading & { readonly shift: boolean; readonly alt: boolean };
  readonly trail: Trail | undefined;
  /** The channels a replacing shape scopes the selection to, every channel where absent. */
  readonly channels: readonly number[] | undefined;
}

/** The trail a press with `tool` starts at `reading`: a lasso's or a brush's, on a spectrogram. */
export function startedTrail(
  tool: ToolId,
  spectral: SpectralToolContext,
  reading: SpectralReading,
): Trail | undefined {
  const { lane } = spectral;
  return (tool === ToolId.SpectralLasso || tool === ToolId.SpectralBrush) && lane !== undefined
    ? Trail.from(traceOf(spectral, lane, reading))
    : undefined;
}

/** `trail` with `reading` traced onto it, `final` at a release; none stays none. */
export function tracedTrail(
  trail: Trail | undefined,
  tool: ToolId,
  spectral: SpectralToolContext,
  reading: SpectralReading,
  final: boolean,
): Trail | undefined {
  const { lane } = spectral;
  if (trail === undefined || lane === undefined) return trail;
  return extendedTrail(trail, traceOf(spectral, lane, reading), tool, spectral.settings, final);
}

/**
 * The shape `drag` has drawn by `reading`, and how it joins the selection, or
 * none where it has drawn nothing a selection can hold.
 */
export function drawnShapeOf(drag: SpectralDrag, reading: SpectralReading): DrawnShape | undefined {
  const { tool, spectral, start, trail } = drag;
  const { lane } = spectral;
  if (lane === undefined) return undefined;
  let shape: SpectralShape | undefined;
  if (tool === ToolId.SpectralMarquee) {
    shape = marqueeShape(traceOf(spectral, lane, start), traceOf(spectral, lane, reading));
  } else if (trail !== undefined) {
    shape =
      tool === ToolId.SpectralLasso
        ? lassoShape(trail.traces())
        : brushShape(trail.traces(), spectral.settings);
  }
  if (shape === undefined) return undefined;
  return {
    shape,
    combination: combinationOf(start),
    feather: spectral.settings.feather,
    channels: drag.channels,
  };
}
