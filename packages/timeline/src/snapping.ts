/**
 * Snapping: moving a position to the nearest thing worth landing on.
 *
 * Every position is already a sample boundary (ADR-0041), which is what
 * snapping to samples means at any zoom, so samples are not a target here. The
 * targets are zero crossings, markers, region and loop boundaries, the
 * playhead, selection edges, the ruler's grid and picture frames, each a
 * boundary gathered by whoever knows it. The rule is deterministic
 * (REQ-EDIT-013): the nearest target within the tolerance wins; at equal
 * distance the earlier kind in {@link SNAP_PRECEDENCE} wins, and then the
 * earlier position, so the same inputs give the same answer whatever order the
 * targets were gathered in.
 *
 * Zero crossings need the audio, which a view does not hold: the waveform
 * package searches the source for them, and the view offers what it found as
 * targets of their kind (the packet's zero-crossing integration hook).
 */

import type { SampleCount } from '@audiogubbins/domain';

import type { BoundaryRange } from './viewport.js';

/** What a position can snap to. */
export const SnapKind = {
  Marker: 'marker',
  RegionBoundary: 'region-boundary',
  LoopBoundary: 'loop-boundary',
  SelectionEdge: 'selection-edge',
  Playhead: 'playhead',
  Frame: 'frame',
  ZeroCrossing: 'zero-crossing',
  Grid: 'grid',
} as const;

export type SnapKind = (typeof SnapKind)[keyof typeof SnapKind];

/**
 * The order kinds win in at equal distance: what the person placed deliberately
 * before what is derived, and the grid last, since it is everywhere.
 */
export const SNAP_PRECEDENCE: readonly SnapKind[] = [
  SnapKind.Marker,
  SnapKind.RegionBoundary,
  SnapKind.LoopBoundary,
  SnapKind.SelectionEdge,
  SnapKind.Playhead,
  SnapKind.Frame,
  SnapKind.ZeroCrossing,
  SnapKind.Grid,
];

const RANK: ReadonlyMap<SnapKind, number> = new Map(
  SNAP_PRECEDENCE.map((kind, index) => [kind, index]),
);

/** A boundary a position can snap to, and what it is. */
export interface SnapTarget {
  readonly kind: SnapKind;
  readonly position: SampleCount;
  /** What the target is called where it has a name, a marker's or a region's. */
  readonly label?: string;
}

/** Where a position landed, and the target it snapped to, if any. */
export interface SnapResult {
  readonly position: SampleCount;
  readonly target?: SnapTarget;
}

/** Whether snapping is on, to which kinds, and how near a target must be. */
export interface SnapSettings {
  readonly enabled: boolean;
  readonly kinds: ReadonlySet<SnapKind>;
  /** How near, in CSS pixels, a target must be to take the position. */
  readonly tolerance: number;
}

/** Every kind except the grid, which crowds a coarse view; within eight pixels. */
export const DEFAULT_SNAP_SETTINGS: SnapSettings = {
  enabled: true,
  kinds: new Set(SNAP_PRECEDENCE.filter((kind) => kind !== SnapKind.Grid)),
  tolerance: 8,
};

function precedes(left: SnapTarget, right: SnapTarget, from: number): boolean {
  const distance = Math.abs(left.position - from) - Math.abs(right.position - from);
  if (distance !== 0) return distance < 0;
  const rank = (RANK.get(left.kind) ?? 0) - (RANK.get(right.kind) ?? 0);
  return rank !== 0 ? rank < 0 : left.position < right.position;
}

/**
 * `position` snapped to the best of `targets` within `within` samples of it,
 * among the kinds `settings` allows, or left where it is.
 */
export function snapped(
  position: SampleCount,
  targets: readonly SnapTarget[],
  settings: SnapSettings,
  within: number,
): SnapResult {
  if (!settings.enabled) return { position };
  let best: SnapTarget | undefined;
  for (const target of targets) {
    if (!settings.kinds.has(target.kind) || Math.abs(target.position - position) > within) continue;
    if (best === undefined || precedes(target, best, position)) best = target;
  }
  return best === undefined ? { position } : { position: best.position, target: best };
}

/** The targets of a set of candidates that fall within `span`. */
export function targetsWithin(
  targets: readonly SnapTarget[],
  span: BoundaryRange,
): readonly SnapTarget[] {
  return targets.filter((target) => target.position >= span.start && target.position <= span.end);
}
