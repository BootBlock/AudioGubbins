/**
 * The snap targets a view offers a position (REQ-EDIT-013): its content's
 * markers, region boundaries and loop points, the playhead, the edges of the
 * time selection, the ruler's grid, the picture's frames where picture is
 * bound, and the zero crossing the waveform package found near the pointer.
 * Each is a boundary; the timeline's rule picks among them.
 */

import type { PlacedMarker, PlacedRegion, SampleCount } from '@audiogubbins/domain';
import {
  SnapKind,
  samplesWithin,
  snapped,
  type BoundaryRange,
  type SnapResult,
  type SnapSettings,
  type SnapTarget,
  type ViewportState,
} from '@audiogubbins/timeline';

/** Everything a view knows that a position can snap to. */
export interface SnapSources {
  readonly markers: readonly PlacedMarker[];
  readonly regions: readonly PlacedRegion[];
  readonly playhead: SampleCount | undefined;
  /** The time selection, whose edges are targets unless one of them is being dragged. */
  readonly selection: BoundaryRange | undefined;
  readonly grid: readonly SampleCount[];
  /** Where picture frames start, where picture is bound. */
  readonly frames: readonly number[];
  /** The zero crossing nearest the pointer, where the search found one. */
  readonly zeroCrossing: SampleCount | undefined;
}

function boundary(value: number): SampleCount {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- a sum of a region's start and an offset within it is a boundary of the asset
  return value as SampleCount;
}

/** The targets of `sources`, each a boundary and its kind. */
export function snapTargetsOf(sources: SnapSources): readonly SnapTarget[] {
  const targets: SnapTarget[] = [];
  for (const marker of sources.markers) {
    targets.push({ kind: SnapKind.Marker, position: marker.position, label: marker.displayName });
  }
  for (const region of sources.regions) {
    targets.push({
      kind: SnapKind.RegionBoundary,
      position: region.start,
      label: region.displayName,
    });
    targets.push({
      kind: SnapKind.RegionBoundary,
      position: boundary(region.start + region.length),
      label: region.displayName,
    });
    if (region.loop !== undefined) {
      targets.push({
        kind: SnapKind.LoopBoundary,
        position: boundary(region.start + region.loop.loopStart),
        label: region.displayName,
      });
      targets.push({
        kind: SnapKind.LoopBoundary,
        position: boundary(region.start + region.loop.loopEnd),
        label: region.displayName,
      });
    }
  }
  if (sources.playhead !== undefined)
    targets.push({ kind: SnapKind.Playhead, position: sources.playhead });
  if (sources.selection !== undefined) {
    targets.push({ kind: SnapKind.SelectionEdge, position: sources.selection.start });
    targets.push({ kind: SnapKind.SelectionEdge, position: sources.selection.end });
  }
  for (const position of sources.grid) targets.push({ kind: SnapKind.Grid, position });
  for (const position of sources.frames)
    targets.push({ kind: SnapKind.Frame, position: boundary(position) });
  if (sources.zeroCrossing !== undefined) {
    targets.push({ kind: SnapKind.ZeroCrossing, position: sources.zeroCrossing });
  }
  return targets;
}

/** `position` snapped among `targets` within the settings' tolerance at the view's zoom. */
export function snapInView(
  position: SampleCount,
  targets: readonly SnapTarget[],
  settings: SnapSettings,
  viewport: ViewportState,
): SnapResult {
  return snapped(position, targets, settings, samplesWithin(viewport, settings.tolerance));
}
