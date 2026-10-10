/**
 * What each tool does with a click and a drag, and what contextual input
 * changes, each resolved to the intents the application commits.
 */

import { describe, expect, it } from 'vitest';

import { RegionBoundary, unsafeBrandId, type MarkerId } from '@audiogubbins/domain';
import { PointerKind } from '@audiogubbins/input';
import { EMPTY_SELECTION, samplesPerPixel, viewportAtStart } from '@audiogubbins/timeline';

import type { HitTarget } from './hit-testing.js';
import { LaneKind, type Lane } from './lane-layout.js';
import { move, press, release } from './pointer-tools.js';
import type { ToolContext, ToolInput, ToolIntent } from './tool-values.js';
import { DEFAULT_SPECTRAL_TOOL_SETTINGS } from './spectral-tools.js';
import { at } from './testing/scene.js';
import { ToolId } from './view-state.js';

function lane(channel: number): Lane {
  return {
    channel,
    kind: LaneKind.Waveform,
    area: { x: 0, y: channel * 100, width: 1000, height: 100 },
  };
}

function input(x: number, overrides: Partial<ToolInput> = {}): ToolInput {
  return {
    x,
    y: 50,
    pointer: PointerKind.Mouse,
    boundary: at(x * 10),
    channel: 0,
    shift: false,
    alt: false,
    strength: 0.75,
    ...overrides,
  };
}

function context(tool: ToolId, hit: HitTarget, overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    tool,
    panning: false,
    hit,
    selection: undefined,
    visibleChannels: [0, 1, 2],
    spectral: {
      lane: lane(0),
      axis: { frequencyScale: 'logarithmic', lowest: 20, highest: 20_000 },
      viewport: viewportAtStart(samplesPerPixel(10), 1000),
      length: at(100_000),
      channelCount: 3,
      selection: EMPTY_SELECTION,
      settings: DEFAULT_SPECTRAL_TOOL_SETTINGS,
    },
    ...overrides,
  };
}

/** The intents of a press at `from`, moves through `through`, and a release at the last. */
function gesture(
  given: ToolContext,
  from: ToolInput,
  ...through: ToolInput[]
): readonly ToolIntent[] {
  let step = press(given, from);
  const intents: ToolIntent[] = [...step.intents];
  for (const each of through) {
    step = move(step.interaction, each);
    intents.push(...step.intents);
  }
  intents.push(...release(step.interaction, through.at(-1) ?? from).intents);
  return intents;
}

const LANE: HitTarget = { kind: 'lane', lane: lane(0) };

describe('the selection tools', () => {
  it('put the playhead where a click lands, and keep the selection', () => {
    expect(gesture(context(ToolId.Select, LANE), input(10))).toEqual([
      { kind: 'set-playhead', position: 100 },
    ]);
  });

  it('select the time a drag covers, narrowed to the lane it stayed in', () => {
    expect(gesture(context(ToolId.Select, LANE), input(10), input(30))).toEqual([
      { kind: 'select-time', range: { start: 100, end: 300 }, channels: [0] },
    ]);
  });

  it('select the channels whose lanes a drag spans, and every channel when it spans them all', () => {
    expect(gesture(context(ToolId.Select, LANE), input(30), input(10, { channel: 1 }))).toEqual([
      { kind: 'select-time', range: { start: 100, end: 300 }, channels: [0, 1] },
    ]);
    expect(gesture(context(ToolId.Select, LANE), input(10), input(30, { channel: 2 }))).toEqual([
      { kind: 'select-time', range: { start: 100, end: 300 }, channels: undefined },
    ]);
  });

  it('select time on every channel with the time-selection tool', () => {
    expect(gesture(context(ToolId.TimeSelect, LANE), input(10), input(30))).toEqual([
      { kind: 'select-time', range: { start: 100, end: 300 }, channels: undefined },
    ]);
  });

  it('extend the selection from its far edge with shift, and move an edge that is dragged', () => {
    const selection = { start: at(100), end: at(300) };
    expect(
      gesture(context(ToolId.Select, LANE, { selection }), input(50, { shift: true })),
    ).toEqual([{ kind: 'select-time', range: { start: 100, end: 500 }, channels: undefined }]);
    const edge: HitTarget = { kind: 'selection-edge', edge: 'end' };
    expect(gesture(context(ToolId.Select, edge, { selection }), input(30), input(60))).toEqual([
      { kind: 'select-time', range: { start: 100, end: 600 }, channels: undefined },
    ]);
  });

  it('select a marker clicked, adding with shift, and move one dragged', () => {
    const on: HitTarget = { kind: 'marker', id: 'm1' as MarkerId };
    expect(gesture(context(ToolId.Select, on), input(10, { shift: true }))).toEqual([
      { kind: 'select-marker', id: 'm1', add: true },
    ]);
    expect(gesture(context(ToolId.Select, on), input(10), input(40))).toEqual([
      { kind: 'move-marker', id: 'm1', to: 400 },
    ]);
  });

  it('move the end of a region dragged in the strip, showing it where the drag is', () => {
    const id = unsafeBrandId<'RegionId'>('r1');
    const start: HitTarget = { kind: 'region-edge', id, boundary: RegionBoundary.Start };
    const pressed = press(context(ToolId.Select, start), input(10));
    expect(move(pressed.interaction, input(25)).preview).toEqual({
      kind: 'region-boundary',
      id,
      boundary: RegionBoundary.Start,
      position: 250,
    });
    expect(gesture(context(ToolId.Select, start), input(10), input(25))).toEqual([
      { kind: 'move-region-boundary', id, boundary: RegionBoundary.Start, to: 250 },
    ]);
    const end: HitTarget = { kind: 'region-edge', id, boundary: RegionBoundary.End };
    expect(gesture(context(ToolId.Region, end), input(40), input(30))).toEqual([
      { kind: 'move-region-boundary', id, boundary: RegionBoundary.End, to: 300 },
    ]);
  });

  it('select a region tapped on its span or its end in the strip, adding with shift', () => {
    const id = unsafeBrandId<'RegionId'>('r1');
    const span: HitTarget = { kind: 'region', id };
    const end: HitTarget = { kind: 'region-edge', id, boundary: RegionBoundary.End };
    expect(gesture(context(ToolId.Select, span), input(10))).toEqual([
      { kind: 'select-region', id, add: false },
    ]);
    expect(gesture(context(ToolId.Region, end), input(10), input(11))).toEqual([
      { kind: 'select-region', id, add: false },
    ]);
    const touch = { pointer: PointerKind.Touch, shift: true };
    expect(gesture(context(ToolId.TimeSelect, span), input(10, touch), input(15, touch))).toEqual([
      { kind: 'select-region', id, add: true },
    ]);
  });

  it('place a marker on a region with the marker tool, and leave a region to the hand and zoom', () => {
    const span: HitTarget = { kind: 'region', id: unsafeBrandId('r1') };
    expect(gesture(context(ToolId.Marker, span), input(10))).toEqual([
      { kind: 'add-marker', at: 100 },
    ]);
    expect(gesture(context(ToolId.Hand, span), input(10))).toEqual([]);
    expect(gesture(context(ToolId.Zoom, span), input(10))).toEqual([
      { kind: 'zoom-step', x: 10, direction: 'in' },
    ]);
  });

  it('read a small movement as a click, and need more of it from a finger than a mouse', () => {
    expect(gesture(context(ToolId.Select, LANE), input(10), input(12))).toEqual([
      { kind: 'set-playhead', position: 100 },
    ]);
    const touch = { pointer: PointerKind.Touch };
    expect(gesture(context(ToolId.Select, LANE), input(10, touch), input(15, touch))).toEqual([
      { kind: 'set-playhead', position: 100 },
    ]);
  });
});

describe('the other tools', () => {
  it('scroll the view as the hand drags, and with any tool while space is held', () => {
    expect(gesture(context(ToolId.Hand, LANE), input(100), input(90), input(80))).toEqual([
      { kind: 'scroll', dx: 10 },
      { kind: 'scroll', dx: 10 },
    ]);
    expect(
      gesture(context(ToolId.Select, LANE, { panning: true }), input(100), input(110)),
    ).toEqual([{ kind: 'scroll', dx: -10 }]);
  });

  it('zoom in at a click, out with alt, and to the range a drag covers', () => {
    expect(gesture(context(ToolId.Zoom, LANE), input(10))).toEqual([
      { kind: 'zoom-step', x: 10, direction: 'in' },
    ]);
    expect(gesture(context(ToolId.Zoom, LANE), input(10, { alt: true }))).toEqual([
      { kind: 'zoom-step', x: 10, direction: 'out' },
    ]);
    expect(gesture(context(ToolId.Zoom, LANE), input(40), input(10))).toEqual([
      { kind: 'zoom-to-range', range: { start: 100, end: 400 } },
    ]);
  });

  it('place a marker where the marker tool clicks, and split where the razor does', () => {
    expect(gesture(context(ToolId.Marker, LANE), input(10))).toEqual([
      { kind: 'add-marker', at: 100 },
    ]);
    expect(gesture(context(ToolId.Razor, LANE), input(10))).toEqual([
      { kind: 'split-at', position: 100 },
    ]);
  });

  it('make a region of the range the region tool drags over, across every channel', () => {
    expect(gesture(context(ToolId.Region, LANE), input(40), input(10))).toEqual([
      { kind: 'make-region', range: { start: 100, end: 400 } },
    ]);
    expect(gesture(context(ToolId.Region, LANE), input(10))).toEqual([
      { kind: 'set-playhead', position: 100 },
    ]);
  });

  it('move the playhead with the pointer along the ruler', () => {
    expect(
      gesture(context(ToolId.Select, { kind: 'ruler' }), input(10), input(20), input(30)),
    ).toEqual([
      { kind: 'set-playhead', position: 200 },
      { kind: 'set-playhead', position: 300 },
      { kind: 'set-playhead', position: 300 },
    ]);
  });
});
