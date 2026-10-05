/**
 * What a pointer is over, for the tool that handles it (REQ-EDIT-065).
 *
 * A finger is wider than a pen tip and a pen's than a cursor's, so the reach of
 * an edge or a marker widens with the pointer's kind (REQ-UX-005). Markers and
 * the ends of regions are grabbed in the strip above the lanes, a marker before
 * a region's end where both are in reach, since a marker is the narrower
 * target; the edges of the time selection are grabbed in the lanes, the nearer
 * of the two where both are in reach; the ruler is the playhead's. Everything
 * is measured from the view's state, not from what was last drawn, so a hit
 * never depends on a stale frame.
 */

import {
  RegionBoundary,
  regionEnd,
  type MarkerId,
  type PlacedMarker,
  type PlacedRegion,
  type RegionId,
} from '@audiogubbins/domain';
import { PointerKind } from '@audiogubbins/input';
import { pixelOf, type BoundaryRange, type ViewportState } from '@audiogubbins/timeline';

import { laneAt, type Lane, type ViewLayout } from './lane-layout.js';

/** What a pointer is over. */
export type HitTarget =
  | { readonly kind: 'marker'; readonly id: MarkerId }
  | { readonly kind: 'region-edge'; readonly id: RegionId; readonly boundary: RegionBoundary }
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
  readonly markers: readonly PlacedMarker[];
  readonly regions: readonly PlacedRegion[];
  /** The time selection, where one is shown. */
  readonly selection: BoundaryRange | undefined;
}

/** How far, in CSS pixels, an edge or a marker reaches for each kind of pointer. */
const REACH: Readonly<Record<PointerKind, number>> = {
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

function nearestMarker(scene: HitScene, x: number, reach: number): PlacedMarker | undefined {
  let best: PlacedMarker | undefined;
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

/** An end of a region, where it lies, and how far it is from the pointer. */
interface RegionEdge {
  readonly id: RegionId;
  readonly boundary: RegionBoundary;
  readonly position: number;
  readonly distance: number;
}

/**
 * Whether `edge` is taken over `other`: the nearer, then the earlier, then a
 * start over an end where two regions meet, then the lesser identity, so the
 * answer does not depend on the list's order.
 */
function preferred(edge: RegionEdge, other: RegionEdge): boolean {
  if (edge.distance !== other.distance) return edge.distance < other.distance;
  if (edge.position !== other.position) return edge.position < other.position;
  if (edge.boundary !== other.boundary) return edge.boundary === RegionBoundary.Start;
  return edge.id < other.id;
}

/** The end of a region nearest `x` within reach, or `undefined`. */
function nearestRegionEdge(scene: HitScene, x: number, reach: number): HitTarget | undefined {
  let best: RegionEdge | undefined;
  for (const region of scene.regions) {
    for (const [boundary, position] of [
      [RegionBoundary.Start, region.start],
      [RegionBoundary.End, regionEnd(region)],
    ] as const) {
      const edge = {
        id: region.id,
        boundary,
        position,
        distance: Math.abs(pixelOf(scene.viewport, position) - x),
      };
      if (edge.distance <= reach && (best === undefined || preferred(edge, best))) best = edge;
    }
  }
  return best === undefined
    ? undefined
    : { kind: 'region-edge', id: best.id, boundary: best.boundary };
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
    if (marker !== undefined) return { kind: 'marker', id: marker.id };
    return nearestRegionEdge(scene, x, reach) ?? { kind: 'strip' };
  }
  if (layout.picture !== undefined && inside(layout.picture, x, y)) return { kind: 'picture' };
  const lane = laneAt(layout, y);
  if (lane === undefined || x < 0 || x >= layout.width) return { kind: 'nothing' };
  const edge = selectionEdge(scene, x, reach);
  return edge === undefined ? { kind: 'lane', lane } : { kind: 'selection-edge', edge };
}
