/**
 * What a pointer is over, for the tool that handles it (REQ-EDIT-065).
 *
 * A finger is wider than a pen tip and a pen's than a cursor's, so the reach of
 * an edge or a marker widens with the pointer's kind (REQ-UX-005). Markers are
 * grabbed in the strip above the lanes, and the edges of the time selection in
 * the lanes, the nearer of the two where both are in reach; the ruler is the
 * playhead's. Everything is measured from the view's state, not from what was
 * last drawn, so a hit never depends on a stale frame.
 */

import type { Marker, MarkerId } from '@audiogubbins/domain';
import { PointerKind } from '@audiogubbins/input';
import { pixelOf, type BoundaryRange, type ViewportState } from '@audiogubbins/timeline';

import { laneAt, type Lane, type ViewLayout } from './lane-layout.js';

/** What a pointer is over. */
export type HitTarget =
  | { readonly kind: 'marker'; readonly id: MarkerId }
  | { readonly kind: 'selection-edge'; readonly edge: 'start' | 'end' }
  | { readonly kind: 'ruler' }
  | { readonly kind: 'strip' }
  | { readonly kind: 'picture' }
  | { readonly kind: 'lane'; readonly lane: Lane }
  | { readonly kind: 'nothing' };

/** What the view shows that a pointer can be over. */
export interface HitScene {
  readonly layout: ViewLayout;
  readonly viewport: ViewportState;
  readonly markers: readonly Marker[];
  /** The time selection, where one is shown. */
  readonly selection: BoundaryRange | undefined;
}

/** How far, in CSS pixels, an edge or a marker reaches for each kind of pointer. */
export const REACH: Readonly<Record<PointerKind, number>> = {
  [PointerKind.Mouse]: 4,
  [PointerKind.Pen]: 6,
  [PointerKind.Touch]: 12,
};

function inside(
  area: { x: number; y: number; width: number; height: number },
  x: number,
  y: number,
): boolean {
  return x >= area.x && x < area.x + area.width && y >= area.y && y < area.y + area.height;
}

function nearestMarker(scene: HitScene, x: number, reach: number): Marker | undefined {
  let best: Marker | undefined;
  let bestDistance = Infinity;
  for (const marker of scene.markers) {
    const distance = Math.abs(pixelOf(scene.viewport, marker.position) - x);
    // The earlier marker wins a tie, so the answer does not depend on the list's order.
    if (
      distance <= reach &&
      (distance < bestDistance ||
        (distance === bestDistance && best !== undefined && marker.position < best.position))
    ) {
      best = marker;
      bestDistance = distance;
    }
  }
  return best;
}

function selectionEdge(scene: HitScene, x: number, reach: number): 'start' | 'end' | undefined {
  if (scene.selection === undefined) return undefined;
  const start = Math.abs(pixelOf(scene.viewport, scene.selection.start) - x);
  const end = Math.abs(pixelOf(scene.viewport, scene.selection.end) - x);
  if (Math.min(start, end) > reach) return undefined;
  return start <= end ? 'start' : 'end';
}

/** What a `pointer` at `x`, `y` is over. */
export function hitTest(scene: HitScene, x: number, y: number, pointer: PointerKind): HitTarget {
  const reach = REACH[pointer];
  const { layout } = scene;
  if (inside(layout.ruler, x, y)) return { kind: 'ruler' };
  if (inside(layout.strip, x, y)) {
    const marker = nearestMarker(scene, x, reach);
    return marker === undefined ? { kind: 'strip' } : { kind: 'marker', id: marker.id };
  }
  if (layout.picture !== undefined && inside(layout.picture, x, y)) return { kind: 'picture' };
  const lane = laneAt(layout, y);
  if (lane === undefined || x < 0 || x >= layout.width) return { kind: 'nothing' };
  const edge = selectionEdge(scene, x, reach);
  return edge === undefined ? { kind: 'lane', lane } : { kind: 'selection-edge', edge };
}
