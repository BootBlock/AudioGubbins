/**
 * The spectral marquee, lasso and brush: the shape each draws on a
 * spectrogram lane, read through the lane's frequency mapping and the view's
 * zoom, how Shift and Alt join it to the selection, the brush's strength from
 * a pen's pressure or the fixed strength, and the preview of the selection a
 * drag would leave, which is the selection its intent makes.
 */

import { describe, expect, it } from 'vitest';

import {
  MaskEffect,
  NO_FEATHER,
  type SpectralMask,
  type SpectralShape,
} from '@audiogubbins/domain';
import {
  DEFAULT_GESTURE_SETTINGS,
  PointerKind,
  toolStrength,
  type GestureSettings,
  type PointerSample,
} from '@audiogubbins/input';
import {
  EMPTY_SELECTION,
  SpectralCombination,
  boundaryAt,
  pixelOf,
  pixelsPerSample,
  samplesPerPixel,
  samplesWithin,
  viewportAtStart,
  withChannels,
  withSpectralMask,
  withTimeRange,
  type SelectionSet,
  type ViewportState,
} from '@audiogubbins/timeline';

import { frequencyAt, frequencyOnAxis, frequencyY } from './frequency-axis.js';
import type { HitTarget } from './hit-testing.js';
import { LaneKind, type Lane } from './lane-layout.js';
import { move, press, release } from './pointer-tools.js';
import type {
  Interaction,
  ToolContext,
  ToolInput,
  ToolIntent,
  ToolPreview,
} from './tool-values.js';
import { withDrawnShape, type DrawnShape } from './spectral-tools.js';
import { at } from './testing/scene.js';
import {
  ToolId,
  newViewState,
  type SpectralSettings,
  type SpectralToolSettings,
} from './view-state.js';

/** How the spectral tools draw in a new view. */
const DEFAULT_TOOLS = newViewState(at(0), 0).spectralTools;

const LENGTH = at(1_000_000);
const AXIS: SpectralSettings = { frequencyScale: 'logarithmic', lowest: 20, highest: 20_000 };

function lane(channel: number, kind: LaneKind = LaneKind.Spectrogram): Lane {
  return { channel, kind, area: { x: 0, y: 40 + channel * 210, width: 1000, height: 200 } };
}

/** Ten samples a pixel, from the start. */
const VIEW = viewportAtStart(samplesPerPixel(10), 1000);

interface Setting {
  readonly tool: ToolId;
  readonly lane?: Lane;
  readonly viewport?: ViewportState;
  readonly selection?: SelectionSet;
  readonly settings?: SpectralToolSettings;
  readonly axis?: SpectralSettings;
}

function context(setting: Setting): ToolContext {
  const shown = setting.lane ?? lane(0);
  const hit: HitTarget = { kind: 'lane', lane: shown };
  return {
    tool: setting.tool,
    panning: false,
    hit,
    selection: undefined,
    visibleChannels: [0, 1],
    spectral: {
      lane: shown,
      axis: setting.axis ?? AXIS,
      viewport: setting.viewport ?? VIEW,
      length: LENGTH,
      channelCount: 2,
      selection: setting.selection ?? EMPTY_SELECTION,
      settings: setting.settings ?? DEFAULT_TOOLS,
    },
  };
}

/** The pointer at `x`, `y` as the application reads it: the boundary under it, and its strength. */
function input(
  x: number,
  y: number,
  overrides: Partial<ToolInput> & { readonly viewport?: ViewportState } = {},
): ToolInput {
  const { viewport = VIEW, ...rest } = overrides;
  return {
    x,
    y,
    pointer: PointerKind.Mouse,
    boundary: boundaryAt(viewport, x, LENGTH),
    channel: 0,
    shift: false,
    alt: false,
    strength: DEFAULT_GESTURE_SETTINGS.fixedStrength,
    ...rest,
  };
}

interface Gesture {
  readonly intents: readonly ToolIntent[];
  readonly previews: readonly (ToolPreview | undefined)[];
}

/** A press at the first input, moves through the rest, and a release at the last. */
function gesture(given: ToolContext, first: ToolInput, ...rest: ToolInput[]): Gesture {
  let step = press(given, first);
  const intents: ToolIntent[] = [...step.intents];
  const previews: (ToolPreview | undefined)[] = [];
  for (const each of rest) {
    step = move(step.interaction, each);
    intents.push(...step.intents);
    previews.push(step.preview);
  }
  intents.push(...release(step.interaction, rest.at(-1) ?? first).intents);
  return { intents, previews };
}

/** The one shape a gesture drew, and how it joins the selection. */
function drawnBy(result: Gesture): DrawnShape {
  const [intent, ...others] = result.intents;
  expect(others).toEqual([]);
  if (intent?.kind !== 'select-spectral')
    throw new Error(`No spectral selection: ${JSON.stringify(intent)}`);
  return intent.drawn;
}

const RIGHT = { frequencyScale: 'linear', lowest: 0, highest: 24_000 } as const;

describe('the spectral marquee', () => {
  it('selects the rectangle a drag spans: its boundaries, and the frequencies at its heights', () => {
    const drawn = drawnBy(
      gesture(context({ tool: ToolId.SpectralMarquee }), input(300, 200), input(120, 90)),
    );
    expect(drawn).toEqual({
      shape: {
        kind: 'rectangle',
        effect: MaskEffect.Add,
        range: { start: 1_200, end: 3_000 },
        band: { low: frequencyAt(lane(0), 200, AXIS), high: frequencyAt(lane(0), 90, AXIS) },
      },
      combination: SpectralCombination.Replace,
      feather: NO_FEATHER,
      channels: [0],
    });
  });

  it('adds to the selection with Shift and takes from it with Alt, Alt winning both', () => {
    const tool = context({ tool: ToolId.SpectralMarquee });
    const with_ = (modifiers: Partial<ToolInput>) =>
      drawnBy(gesture(tool, input(100, 100, modifiers), input(200, 150))).combination;
    expect(with_({ shift: true })).toBe(SpectralCombination.Add);
    expect(with_({ alt: true })).toBe(SpectralCombination.Subtract);
    expect(with_({ shift: true, alt: true })).toBe(SpectralCombination.Subtract);
  });

  it('selects nothing from a drag no taller than a point, which has no band', () => {
    expect(
      gesture(context({ tool: ToolId.SpectralMarquee }), input(100, 100), input(200, 100)).intents,
    ).toEqual([]);
  });

  it('keeps the band within the lane where a drag leaves it', () => {
    const drawn = drawnBy(
      gesture(context({ tool: ToolId.SpectralMarquee }), input(100, 100), input(200, 900)),
    );
    expect(drawn.shape.kind === 'rectangle' && drawn.shape.band.low).toBe(AXIS.lowest);
  });

  it('draws on a spectrogram only, and places the playhead where it is clicked elsewhere', () => {
    const waveform = context({ tool: ToolId.SpectralMarquee, lane: lane(0, LaneKind.Waveform) });
    expect(gesture(waveform, input(100, 100), input(200, 150)).intents).toEqual([]);
    expect(gesture(waveform, input(100, 100)).intents).toEqual([
      { kind: 'set-playhead', position: 1_000 },
    ]);
  });

  it('draws over the spectrogram an overlay lane shows', () => {
    const overlay = context({ tool: ToolId.SpectralMarquee, lane: lane(0, LaneKind.Overlay) });
    expect(drawnBy(gesture(overlay, input(100, 100), input(200, 150))).shape.kind).toBe(
      'rectangle',
    );
  });
});

describe('the spectral lasso', () => {
  it('selects the area its path encloses, the points it passed through kept a few pixels apart', () => {
    const path = [
      input(100, 100),
      input(101, 100),
      input(150, 100),
      input(150, 160),
      input(151, 161),
      input(100, 160),
    ];
    const [first, ...rest] = path;
    if (first === undefined) throw new Error('No path.');
    const drawn = drawnBy(gesture(context({ tool: ToolId.SpectralLasso }), first, ...rest));
    const kept = [path[0], path[2], path[3], path[5]];
    expect(drawn.shape).toEqual({
      kind: 'polygon',
      effect: MaskEffect.Add,
      points: kept.map((each) => ({
        position: each?.boundary,
        frequency: frequencyAt(lane(0), each?.y ?? 0, AXIS),
      })),
    });
  });

  it('selects nothing from a path that encloses nothing', () => {
    const tool = context({ tool: ToolId.SpectralLasso });
    expect(gesture(tool, input(100, 100), input(150, 100), input(200, 100)).intents).toEqual([]);
    expect(gesture(tool, input(100, 100), input(150, 150)).intents).toEqual([]);
  });

  it('takes the point it is let go at, though no move reached it', () => {
    const tool = context({ tool: ToolId.SpectralLasso });
    let step = press(tool, input(100, 100));
    step = move(step.interaction, input(150, 100));
    step = move(step.interaction, input(150, 160));
    const [intent] = release(step.interaction, input(100, 160)).intents;
    const shape = intent?.kind === 'select-spectral' ? intent.drawn.shape : undefined;
    expect(shape?.kind === 'polygon' && shape.points.map((point) => point.position)).toEqual([
      1_000, 1_500, 1_500, 1_000,
    ]);
  });

  it('places the playhead where it is clicked, as the time-selection tool does', () => {
    expect(gesture(context({ tool: ToolId.SpectralLasso }), input(100, 100)).intents).toEqual([
      { kind: 'set-playhead', position: 1_000 },
    ]);
  });
});

/** A pen's sample at `x`, `y`, pressing `pressure`. */
function pen(x: number, y: number, pressure: number): PointerSample {
  return { pointerId: 1, kind: PointerKind.Pen, x, y, pressure, timestamp: 0 };
}

/** The application's reading of `sample`: its strength by the person's pressure choice. */
function read(sample: PointerSample, gestures: GestureSettings): ToolInput {
  return input(sample.x, sample.y, {
    pointer: sample.kind,
    strength: toolStrength(sample, gestures),
  });
}

function brushed(gestures: GestureSettings, samples: readonly PointerSample[]): SpectralShape {
  const [first, ...rest] = samples.map((sample) => read(sample, gestures));
  if (first === undefined) throw new Error('No stroke.');
  return drawnBy(gesture(context({ tool: ToolId.SpectralBrush }), first, ...rest)).shape;
}

const STROKE = [pen(100, 100, 0.2), pen(110, 104, 0.6), pen(125, 110, 0.9), pen(140, 112, 0.4)];

describe('the spectral brush', () => {
  it('strokes its path, each point with its strength and its radius converted where it is', () => {
    const shape = brushed(DEFAULT_GESTURE_SETTINGS, STROKE);
    const radius = DEFAULT_TOOLS.brushRadius;
    expect(shape).toEqual({
      kind: 'stroke',
      effect: MaskEffect.Add,
      hardness: DEFAULT_TOOLS.hardness,
      points: STROKE.map((sample) => ({
        position: boundaryAt(VIEW, sample.x, LENGTH),
        frequency: frequencyAt(lane(0), sample.y, AXIS),
        strength: sample.pressure,
        radius: {
          time: samplesWithin(VIEW, radius),
          frequency:
            (frequencyOnAxis(lane(0), sample.y - radius, AXIS) -
              frequencyOnAxis(lane(0), sample.y + radius, AXIS)) /
            2,
        },
      })),
    });
  });

  it('keeps its drawn shape on a logarithmic axis: wider in hertz where it is higher', () => {
    const shape = brushed(DEFAULT_GESTURE_SETTINGS, [pen(100, 60, 0.5), pen(100, 220, 0.5)]);
    if (shape.kind !== 'stroke') throw new Error('Not a stroke.');
    const [high, low] = shape.points;
    expect(high.radius.frequency).toBeGreaterThan(low?.radius.frequency ?? Infinity);
    // The same circle on screen: its reach in hertz is the axis's span over its diameter.
    const top = frequencyOnAxis(lane(0), 60 - 12, AXIS);
    const bottom = frequencyOnAxis(lane(0), 60 + 12, AXIS);
    expect(high.radius.frequency).toBeCloseTo((top - bottom) / 2, 9);
  });

  it('strokes at the fixed strength, the same on every pointer, where the person turns pressure off', () => {
    const off: GestureSettings = { ...DEFAULT_GESTURE_SETTINGS, usePenPressure: false };
    const shape = brushed(off, STROKE);
    if (shape.kind !== 'stroke') throw new Error('Not a stroke.');
    expect(shape.points.map((point) => point.strength)).toEqual(
      STROKE.map(() => off.fixedStrength),
    );
    const mouse = STROKE.map(({ pressure: _pressure, ...rest }) => ({
      ...rest,
      kind: PointerKind.Mouse,
    }));
    expect(brushed(DEFAULT_GESTURE_SETTINGS, mouse)).toEqual(
      brushed(
        { ...DEFAULT_GESTURE_SETTINGS, fixedStrength: off.fixedStrength },
        STROKE.map(({ pressure: _pressure, ...rest }) => rest),
      ),
    );
    expect(shape).toEqual(brushed(off, STROKE));
  });

  it('marks at the lightest strength a mask holds where a pen touches at no pressure', () => {
    const shape = brushed(DEFAULT_GESTURE_SETTINGS, [pen(100, 100, 0)]);
    if (shape.kind !== 'stroke') throw new Error('Not a stroke.');
    expect(shape.points[0].strength).toBeGreaterThan(0);
    expect(shape.points[0].strength).toBeLessThan(0.01);
  });

  it('marks one dab where it is clicked', () => {
    const drawn = drawnBy(gesture(context({ tool: ToolId.SpectralBrush }), input(100, 100)));
    expect(drawn.shape.kind === 'stroke' && drawn.shape.points).toHaveLength(1);
  });

  it('keeps a stroke’s points a quarter of its radius apart', () => {
    const settings = { ...DEFAULT_TOOLS, brushRadius: 20 };
    const steps = Array.from({ length: 41 }, (_, index) => input(100 + index, 100));
    const [first, ...rest] = steps;
    if (first === undefined) throw new Error('No stroke.');
    const drawn = drawnBy(
      gesture(context({ tool: ToolId.SpectralBrush, settings }), first, ...rest),
    );
    if (drawn.shape.kind !== 'stroke') throw new Error('Not a stroke.');
    expect(drawn.shape.points.map((point) => point.position)).toEqual(
      [100, 105, 110, 115, 120, 125, 130, 135, 140].map((x) => x * 10),
    );
  });

  it('takes the hardness and the softness the person set', () => {
    const settings: SpectralToolSettings = {
      brushRadius: 8,
      hardness: 0.25,
      feather: { time: 100, frequency: 50 },
      combination: SpectralCombination.Replace,
    };
    const drawn = drawnBy(
      gesture(context({ tool: ToolId.SpectralBrush, settings }), input(100, 100), input(140, 120)),
    );
    expect(drawn.shape.kind === 'stroke' && drawn.shape.hardness).toBe(0.25);
    expect(drawn.feather).toEqual({ time: 100, frequency: 50 });
  });
});

/** A finger's sample at `x`, `y`: a touch reports no pressure a tool reads. */
function finger(x: number, y: number): PointerSample {
  return { pointerId: 2, kind: PointerKind.Touch, x, y, pressure: 0.5, timestamp: 0 };
}

/** A finger's drag through `samples`, as the application reads each: no modifier is held. */
function touched(given: ToolContext, samples: readonly PointerSample[]): Gesture {
  const [first, ...rest] = samples.map((sample) => read(sample, DEFAULT_GESTURE_SETTINGS));
  if (first === undefined) throw new Error('No touch.');
  return gesture(given, first, ...rest);
}

/** The spectral tool `tool`, joining a shape drawn with no modifier as `combination` says. */
function latched(tool: ToolId, combination: SpectralCombination, selection?: SelectionSet) {
  return context({
    tool,
    settings: { ...DEFAULT_TOOLS, combination },
    ...(selection === undefined ? {} : { selection }),
  });
}

describe('the spectral tools by touch (ADR-0082)', () => {
  it('selects the rectangle a finger drags across, as a mouse does', () => {
    const tool = context({ tool: ToolId.SpectralMarquee });
    expect(drawnBy(touched(tool, [finger(300, 200), finger(120, 90)]))).toEqual(
      drawnBy(gesture(tool, input(300, 200), input(120, 90))),
    );
  });

  it('adds to and takes from the selection as the combination mode says, which a finger cannot hold a key for', () => {
    const drag = [finger(100, 100), finger(200, 150)];
    for (const tool of [ToolId.SpectralMarquee, ToolId.SpectralLasso, ToolId.SpectralBrush]) {
      const path = tool === ToolId.SpectralLasso ? [...drag, finger(100, 150)] : drag;
      for (const combination of Object.values(SpectralCombination)) {
        expect(drawnBy(touched(latched(tool, combination), path)).combination).toBe(combination);
      }
    }
  });

  it('builds a compound selection from shapes a finger draws one after another', () => {
    let selection = EMPTY_SELECTION;
    for (const [combination, from, to] of [
      [SpectralCombination.Replace, finger(100, 60), finger(400, 200)],
      [SpectralCombination.Add, finger(500, 60), finger(700, 200)],
      [SpectralCombination.Subtract, finger(150, 100), finger(250, 150)],
    ] as const) {
      const drawn = drawnBy(
        touched(latched(ToolId.SpectralMarquee, combination, selection), [from, to]),
      );
      selection = withDrawnShape(selection, drawn, 2);
    }
    expect(selection.spectral?.shapes.map((shape) => shape.effect)).toEqual([
      MaskEffect.Add,
      MaskEffect.Add,
      MaskEffect.Subtract,
    ]);
  });

  it('lets a held modifier say how, over the combination mode', () => {
    const at_ = (combination: SpectralCombination, modifiers: Partial<ToolInput>) =>
      drawnBy(
        gesture(
          latched(ToolId.SpectralMarquee, combination),
          input(100, 100, modifiers),
          input(200, 150),
        ),
      ).combination;
    expect(at_(SpectralCombination.Add, { alt: true })).toBe(SpectralCombination.Subtract);
    expect(at_(SpectralCombination.Subtract, { shift: true })).toBe(SpectralCombination.Add);
    expect(at_(SpectralCombination.Subtract, {})).toBe(SpectralCombination.Subtract);
  });

  it('encloses the area of a finger’s lasso path', () => {
    const drawn = drawnBy(
      touched(context({ tool: ToolId.SpectralLasso }), [
        finger(100, 100),
        finger(150, 100),
        finger(150, 160),
        finger(100, 160),
      ]),
    );
    expect(drawn.shape.kind === 'polygon' && drawn.shape.points).toHaveLength(4);
  });

  it('strokes a finger’s path at the fixed strength, since a touch has no pressure to read', () => {
    const drawn = drawnBy(
      touched(context({ tool: ToolId.SpectralBrush }), [
        finger(100, 100),
        finger(120, 104),
        finger(140, 110),
      ]),
    );
    if (drawn.shape.kind !== 'stroke') throw new Error('Not a stroke.');
    expect(drawn.shape.points.map((point) => point.strength)).toEqual([
      DEFAULT_GESTURE_SETTINGS.fixedStrength,
      DEFAULT_GESTURE_SETTINGS.fixedStrength,
      DEFAULT_GESTURE_SETTINGS.fixedStrength,
    ]);
  });

  it('marks one dab where a finger trembles less than a touch’s drag threshold', () => {
    const drawn = drawnBy(
      touched(context({ tool: ToolId.SpectralBrush }), [finger(100, 100), finger(104, 102)]),
    );
    expect(drawn.shape.kind === 'stroke' && drawn.shape.points).toHaveLength(1);
  });
});

describe('a spectral drag in progress', () => {
  it('shows the selection its shape would leave, which is the selection its intent makes', () => {
    const kept: SpectralMask = {
      shapes: [
        {
          kind: 'rectangle',
          effect: MaskEffect.Add,
          range: { start: at(0), end: at(500) },
          band: { low: 100, high: 200 },
        },
      ],
      feather: NO_FEATHER,
    };
    const selection = withSpectralMask(EMPTY_SELECTION, kept);
    const tool = context({ tool: ToolId.SpectralMarquee, selection });
    const result = gesture(tool, input(100, 100, { shift: true }), input(200, 150));
    const [preview] = result.previews;
    const drawn = drawnBy(result);
    expect(preview).toEqual({
      kind: 'spectral-shape',
      drawn,
      selection: withDrawnShape(selection, drawn, 2),
    });
    expect(preview?.kind === 'spectral-shape' && preview.selection.spectral?.shapes).toHaveLength(
      2,
    );
  });

  it('copies nothing it shares with another drag from the same press', () => {
    const tool = context({ tool: ToolId.SpectralLasso });
    let pressed: Interaction = press(tool, input(100, 100)).interaction;
    pressed = move(pressed, input(150, 100)).interaction;
    const one = move(move(pressed, input(150, 150)).interaction, input(100, 150)).interaction;
    const other = move(move(pressed, input(100, 160)).interaction, input(80, 140)).interaction;
    const shapeOf = (interaction: Interaction, last: ToolInput) => {
      const [intent] = release(interaction, last).intents;
      return intent?.kind === 'select-spectral' ? intent.drawn.shape : undefined;
    };
    const points = (shape: SpectralShape | undefined) =>
      shape?.kind === 'polygon' ? shape.points.map((point) => point.position) : [];
    expect(points(shapeOf(one, input(100, 150)))).toEqual([1_000, 1_500, 1_500, 1_000]);
    expect(points(shapeOf(other, input(80, 140)))).toEqual([1_000, 1_500, 1_000, 800]);
  });
});

describe('joining a drawn shape to the selection', () => {
  const shape: SpectralShape = {
    kind: 'rectangle',
    effect: MaskEffect.Add,
    range: { start: at(10), end: at(20) },
    band: { low: 100, high: 200 },
  };
  const drawn = (combination: SpectralCombination): DrawnShape => ({
    shape,
    combination,
    feather: NO_FEATHER,
    channels: [1],
  });

  it('scopes a replacing shape to the channels it was drawn in', () => {
    const joined = withDrawnShape(EMPTY_SELECTION, drawn(SpectralCombination.Replace), 2);
    expect(joined.channels).toEqual([1]);
    expect(joined.spectral?.shapes).toEqual([shape]);
  });

  it('keeps the scope where a shape joins the selection', () => {
    const scoped = withChannels(
      withTimeRange(EMPTY_SELECTION, { start: at(0), end: at(5) }),
      [0],
      2,
    );
    const kept = withSpectralMask(scoped, { shapes: [shape], feather: NO_FEATHER });
    expect(withDrawnShape(kept, drawn(SpectralCombination.Add), 2).channels).toEqual([0]);
    expect(withDrawnShape(kept, drawn(SpectralCombination.Subtract), 2).spectral?.shapes).toEqual([
      shape,
      { ...shape, effect: MaskEffect.Subtract },
    ]);
  });

  it('leaves a selection with no spectral area as it was where a shape only takes away', () => {
    const scoped = withChannels(EMPTY_SELECTION, [0], 2);
    expect(withDrawnShape(scoped, drawn(SpectralCombination.Subtract), 2)).toBe(scoped);
  });
});

describe('a shape drawn at any zoom', () => {
  it('is drawn back where it was drawn, at every zoom and on either scale', () => {
    for (const axis of [AXIS, RIGHT]) {
      for (const viewport of [
        VIEW,
        viewportAtStart(samplesPerPixel(1), 1000),
        { ...viewportAtStart(pixelsPerSample(8), 1000), start: at(4_000), offset: 3 },
      ]) {
        const tool = context({ tool: ToolId.SpectralMarquee, viewport, axis });
        const drawn = drawnBy(
          gesture(tool, input(300, 70, { viewport }), input(620, 180, { viewport })),
        );
        if (drawn.shape.kind !== 'rectangle') throw new Error('Not a rectangle.');
        const { range, band } = drawn.shape;
        // A position snaps to the nearest boundary, never further than half a sample.
        const half = pixelOf(viewport, 1) - pixelOf(viewport, 0);
        expect(Math.abs(pixelOf(viewport, range.start) - 300)).toBeLessThanOrEqual(
          Math.max(half / 2, 0.5),
        );
        expect(Math.abs(pixelOf(viewport, range.end) - 620)).toBeLessThanOrEqual(
          Math.max(half / 2, 0.5),
        );
        expect(frequencyY(lane(0), band.high, axis)).toBeCloseTo(70, 9);
        expect(frequencyY(lane(0), band.low, axis)).toBeCloseTo(180, 9);
      }
    }
  });
});
