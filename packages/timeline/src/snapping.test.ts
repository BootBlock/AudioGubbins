import type { SampleCount } from '@audiogubbins/domain';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SNAP_SETTINGS,
  SNAP_PRECEDENCE,
  SnapKind,
  snapped,
  targetsWithin,
  type SnapSettings,
  type SnapTarget,
} from './snapping.js';

const at = (value: number): SampleCount => value as SampleCount;
const target = (kind: SnapKind, position: number): SnapTarget => ({ kind, position: at(position) });

const EVERY_KIND: SnapSettings = { enabled: true, kinds: new Set(SNAP_PRECEDENCE), tolerance: 8 };

describe('snapping a position', () => {
  it('takes the nearest target within the tolerance', () => {
    const targets = [target(SnapKind.Marker, 90), target(SnapKind.Playhead, 104)];
    expect(snapped(at(100), targets, EVERY_KIND, 10)).toEqual({
      position: 104,
      target: targets[1],
    });
  });

  it('leaves a position where it is with nothing near enough, or snapping off', () => {
    const targets = [target(SnapKind.Marker, 150)];
    expect(snapped(at(100), targets, EVERY_KIND, 10)).toEqual({ position: 100 });
    expect(
      snapped(at(100), [target(SnapKind.Marker, 101)], { ...EVERY_KIND, enabled: false }, 10),
    ).toEqual({
      position: 100,
    });
  });

  it('breaks a tie of distance by the precedence of kinds, then by the earlier position', () => {
    const tied = [
      target(SnapKind.Grid, 95),
      target(SnapKind.ZeroCrossing, 105),
      target(SnapKind.Marker, 105),
    ];
    expect(snapped(at(100), tied, EVERY_KIND, 10).target).toEqual(target(SnapKind.Marker, 105));
    const sameKind = [target(SnapKind.Grid, 105), target(SnapKind.Grid, 95)];
    expect(snapped(at(100), sameKind, EVERY_KIND, 10).position).toBe(95);
  });

  it('gives the same answer whatever order the targets were gathered in', () => {
    const targets = [
      target(SnapKind.Frame, 97),
      target(SnapKind.SelectionEdge, 103),
      target(SnapKind.RegionBoundary, 97),
      target(SnapKind.LoopBoundary, 103),
    ];
    const forwards = snapped(at(100), targets, EVERY_KIND, 10);
    expect(snapped(at(100), [...targets].reverse(), EVERY_KIND, 10)).toEqual(forwards);
    expect(forwards.target).toEqual(target(SnapKind.RegionBoundary, 97));
  });

  it('takes only the kinds the settings allow, and leaves the grid out by default', () => {
    const targets = [target(SnapKind.Grid, 101), target(SnapKind.Playhead, 106)];
    expect(snapped(at(100), targets, DEFAULT_SNAP_SETTINGS, 10).target?.kind).toBe(
      SnapKind.Playhead,
    );
  });

  it('keeps the targets inside a window', () => {
    const targets = [
      target(SnapKind.Marker, 5),
      target(SnapKind.Marker, 10),
      target(SnapKind.Marker, 20),
    ];
    expect(targetsWithin(targets, { start: at(10), end: at(20) })).toEqual(targets.slice(1));
  });
});
