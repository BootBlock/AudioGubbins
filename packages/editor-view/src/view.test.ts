/**
 * An editor view as values: its state, its lanes for every display mode and any
 * channel count, what a pointer is over, and the snap targets it offers.
 */

import { describe, expect, it } from 'vitest';

import { RegionBoundary } from '@audiogubbins/domain';
import { PointerKind } from '@audiogubbins/input';
import {
  DEFAULT_SNAP_SETTINGS,
  SnapKind,
  pixelsPerSample,
  samplesPerPixel,
  viewportAtStart,
} from '@audiogubbins/timeline';

import { hitTest, type HitScene } from './hit-testing.js';
import { LaneKind, laneAt, layoutView } from './lane-layout.js';
import { snapInView, snapTargetsOf } from './snap-candidates.js';
import { at, marker, region } from './testing/scene.js';
import {
  DisplayMode,
  newViewState,
  visibleChannels,
  withAmplitudeStep,
  withChannelShown,
} from './view-state.js';

const STATE = newViewState(at(48_000), 1000);

describe('a view state', () => {
  it('starts showing the whole asset, every channel, at full scale', () => {
    expect(STATE.viewport.zoom).toEqual(samplesPerPixel(48));
    expect(visibleChannels(STATE, 6)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(STATE.amplitude).toBe(1);
  });

  it('hides and shows channels, but never the last one shown', () => {
    const one = withChannelShown(withChannelShown(STATE, 0, false, 3), 2, false, 3);
    expect(visibleChannels(one, 3)).toEqual([1]);
    expect(withChannelShown(one, 1, false, 3)).toBe(one);
    expect(visibleChannels(withChannelShown(one, 0, true, 3), 3)).toEqual([0, 1]);
  });

  it('steps its amplitude within its steps', () => {
    expect(withAmplitudeStep(STATE, 2).amplitude).toBe(4);
    expect(withAmplitudeStep(STATE, -1)).toBe(STATE);
    expect(withAmplitudeStep({ ...STATE, amplitude: 64 }, 1).amplitude).toBe(64);
  });
});

describe('laying a view out', () => {
  it('gives every channel of a 5.1 layout a lane of its own, in order, filling the height', () => {
    const layout = layoutView(STATE, 1000, 600, 6, false);
    expect(layout.lanes.map((lane) => lane.channel)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(layout.lanes[0]?.area.y).toBe(layout.strip.y + layout.strip.height);
    const last = layout.lanes.at(-1)!.area;
    expect(last.y + last.height).toBeCloseTo(600, 6);
  });

  it('arranges the lanes for each display mode', () => {
    const kinds = (mode: DisplayMode) =>
      layoutView({ ...STATE, displayMode: mode }, 1000, 400, 2, false).lanes.map((lane) => [
        lane.channel,
        lane.kind,
      ]);
    expect(kinds(DisplayMode.Waveform)).toEqual([
      [0, LaneKind.Waveform],
      [1, LaneKind.Waveform],
    ]);
    expect(kinds(DisplayMode.Spectrogram)).toEqual([
      [0, LaneKind.Spectrogram],
      [1, LaneKind.Spectrogram],
    ]);
    expect(kinds(DisplayMode.Stacked)).toEqual([
      [0, LaneKind.Waveform],
      [0, LaneKind.Spectrogram],
      [1, LaneKind.Waveform],
      [1, LaneKind.Spectrogram],
    ]);
    expect(kinds(DisplayMode.Overlay)).toEqual([
      [0, LaneKind.Overlay],
      [1, LaneKind.Overlay],
    ]);
  });

  it('leaves hidden channels out, and a picture strip in only where picture is bound and wanted', () => {
    const hidden = withChannelShown(STATE, 1, false, 3);
    expect(layoutView(hidden, 1000, 400, 3, false).lanes.map((lane) => lane.channel)).toEqual([
      0, 2,
    ]);
    expect(layoutView(STATE, 1000, 400, 1, true).picture).toBeDefined();
    expect(layoutView(STATE, 1000, 400, 1, false).picture).toBeUndefined();
    const off = { ...STATE, overlays: { ...STATE.overlays, filmstrip: false } };
    expect(layoutView(off, 1000, 400, 1, true).picture).toBeUndefined();
  });

  it('finds the lane under a height', () => {
    const layout = layoutView(STATE, 1000, 400, 2, false);
    expect(laneAt(layout, layout.lanes[1]!.area.y + 1)?.channel).toBe(1);
    expect(laneAt(layout, 5)).toBeUndefined();
  });
});

describe('what a pointer is over', () => {
  const layout = layoutView(STATE, 1000, 400, 2, false);
  const scene: HitScene = {
    layout,
    viewport: viewportAtStart(samplesPerPixel(10), 1000),
    markers: [marker('a', 1000), marker('b', 1060)],
    // Drawn from 130 to 200, and from 200 to 250, listed out of order.
    regions: [region('s', 2000, 500), region('r', 1300, 700)],
    selection: { start: at(3000), end: at(5000) },
  };
  const stripY = layout.strip.y + 2;
  const laneY = layout.lanes[0]!.area.y + 10;

  it('is the ruler above everything', () => {
    expect(hitTest(scene, 100, 5, PointerKind.Mouse)).toEqual({ kind: 'ruler' });
  });

  it('is a marker in the strip within the reach of the pointer, wider for a finger than a cursor', () => {
    // The markers are drawn at 100 and 106.
    expect(hitTest(scene, 98, stripY, PointerKind.Mouse)).toEqual({ kind: 'marker', id: 'a' });
    expect(hitTest(scene, 112, stripY, PointerKind.Mouse)).toEqual({ kind: 'strip' });
    expect(hitTest(scene, 112, stripY, PointerKind.Touch)).toEqual({ kind: 'marker', id: 'b' });
    // Equally near two markers, the earlier wins.
    expect(hitTest(scene, 103, stripY, PointerKind.Touch)).toEqual({ kind: 'marker', id: 'a' });
  });

  it('is the nearest end of a region in the strip within reach, its span inside, and the strip elsewhere', () => {
    expect(hitTest(scene, 248, stripY, PointerKind.Mouse)).toEqual({
      kind: 'region-edge',
      id: 's',
      boundary: RegionBoundary.End,
    });
    expect(hitTest(scene, 160, stripY, PointerKind.Mouse)).toEqual({ kind: 'region', id: 'r' });
    expect(hitTest(scene, 300, stripY, PointerKind.Mouse)).toEqual({ kind: 'strip' });
    // Where one region ends and the next starts, the start is taken, whichever is listed first.
    expect(hitTest(scene, 203, stripY, PointerKind.Mouse)).toEqual({
      kind: 'region-edge',
      id: 's',
      boundary: RegionBoundary.Start,
    });
    expect(
      hitTest({ ...scene, regions: scene.regions.toReversed() }, 197, stripY, PointerKind.Mouse),
    ).toEqual({ kind: 'region-edge', id: 's', boundary: RegionBoundary.Start });
    // In a lane a region's end is not grabbed: the lanes are the selection's.
    expect(hitTest(scene, 248, laneY, PointerKind.Mouse)).toMatchObject({ kind: 'lane' });
  });

  it('is the shortest of the regions whose spans hold the pointer, so a longer one is reached outside it', () => {
    // Drawn from 100 to 300, and from 150 to 200 inside it.
    const nested = {
      ...scene,
      markers: [],
      regions: [region('long', 1000, 2000), region('short', 1500, 500)],
    };
    expect(hitTest(nested, 170, stripY, PointerKind.Mouse)).toEqual({
      kind: 'region',
      id: 'short',
    });
    expect(hitTest(nested, 250, stripY, PointerKind.Mouse)).toEqual({ kind: 'region', id: 'long' });
  });

  it('is a marker before a nearer end of a region, since a marker is the narrower target', () => {
    const crowded = { ...scene, regions: [region('r', 1080, 200)] };
    // The marker at 106 is three pixels away, the region's start at 108 one.
    expect(hitTest(crowded, 109, stripY, PointerKind.Mouse)).toEqual({ kind: 'marker', id: 'b' });
    expect(hitTest(crowded, 111, stripY, PointerKind.Mouse)).toEqual({
      kind: 'region-edge',
      id: 'r',
      boundary: RegionBoundary.Start,
    });
  });

  it('is the nearer edge of the time selection in a lane, and the lane elsewhere', () => {
    expect(hitTest(scene, 302, laneY, PointerKind.Mouse)).toEqual({
      kind: 'selection-edge',
      edge: 'start',
    });
    expect(hitTest(scene, 497, laneY, PointerKind.Pen)).toEqual({
      kind: 'selection-edge',
      edge: 'end',
    });
    expect(hitTest(scene, 400, laneY, PointerKind.Mouse)).toMatchObject({
      kind: 'lane',
      lane: { channel: 0 },
    });
  });
});

describe('snap targets', () => {
  it('offers markers, region and loop boundaries, the playhead, selection edges, grid, frames and a zero crossing', () => {
    const looped = {
      ...region('r', 1000, 500),
      loop: { loopStart: at(100), loopEnd: at(400), crossfadeLength: at(0) },
    };
    const targets = snapTargetsOf({
      markers: [marker('m', 10)],
      regions: [looped],
      playhead: at(20),
      selection: { start: at(30), end: at(40) },
      grid: [at(50)],
      frames: [60],
      zeroCrossing: at(70),
    });
    expect(targets.map((target) => [target.kind, target.position])).toEqual([
      [SnapKind.Marker, 10],
      [SnapKind.RegionBoundary, 1000],
      [SnapKind.RegionBoundary, 1500],
      [SnapKind.LoopBoundary, 1100],
      [SnapKind.LoopBoundary, 1400],
      [SnapKind.Playhead, 20],
      [SnapKind.SelectionEdge, 30],
      [SnapKind.SelectionEdge, 40],
      [SnapKind.Grid, 50],
      [SnapKind.Frame, 60],
      [SnapKind.ZeroCrossing, 70],
    ]);
  });

  it('snaps within the tolerance in pixels at the view zoom', () => {
    const targets = [{ kind: SnapKind.Marker, position: at(1000) }];
    const coarse = viewportAtStart(samplesPerPixel(100), 1000);
    expect(snapInView(at(1700), targets, DEFAULT_SNAP_SETTINGS, coarse).position).toBe(1000);
    const fine = viewportAtStart(pixelsPerSample(16), 1000);
    expect(snapInView(at(1002), targets, DEFAULT_SNAP_SETTINGS, fine).position).toBe(1002);
    expect(snapInView(at(1001), targets, DEFAULT_SNAP_SETTINGS, fine).position).toBe(1000);
  });
});
