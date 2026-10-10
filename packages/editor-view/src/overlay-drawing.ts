/**
 * Drawing what lies over a lane: the grid, the selection, the regions, loop
 * points and markers, what a drag shows before it is committed, and the
 * playhead.
 *
 * A kept selection is always drawn (REQ-EDIT-064): the active facet in the
 * selection colour, one kept but not active in a quieter wash, so a range the
 * person made earlier is never a surprise. A time range narrowed to some
 * channels washes only their lanes (REQ-EDIT-063).
 */

import type { Colour, RenderBatch } from '@audiogubbins/renderer';
import type { PlacedMarker, PlacedRegion } from '@audiogubbins/domain';
import {
  SelectionFacet,
  activeFacet,
  pixelOf,
  type BoundaryRange,
  type SelectionSet,
} from '@audiogubbins/timeline';

import type { BuilderPool, RectangleBuilder } from './batch-buffers.js';
import { frequencyY } from './frequency-axis.js';
import type { Lane } from './lane-layout.js';
import type { ToolPreview } from './pointer-tools.js';
import { crispX, type OverlayStyle } from './ruler-drawing.js';
import type { SpectralSettings } from './view-state.js';

/** What a lane's overlays read. */
export interface LaneOverlay {
  readonly selection: SelectionSet;
  readonly markers: readonly PlacedMarker[];
  readonly regions: readonly PlacedRegion[];
  readonly playhead: number | undefined;
  readonly preview: ToolPreview | undefined;
  readonly grid: readonly number[] | undefined;
  readonly spectral: SpectralSettings;
}

function inScope(channels: readonly number[] | undefined, channel: number): boolean {
  return channels === undefined || channels.includes(channel);
}

/** A vertical line across `lane` at `position`, `widthInPixels` device pixels wide. */
function across(
  builder: RectangleBuilder,
  style: OverlayStyle,
  lane: Lane,
  position: number,
  widthInPixels = 1,
): void {
  const x = crispX(style, position, lane.area.width);
  if (x !== undefined) {
    builder.add(x, lane.area.y, widthInPixels / style.pixelRatio, lane.area.height);
  }
}

function wash(
  pool: BuilderPool,
  style: OverlayStyle,
  lane: Lane,
  range: BoundaryRange,
  fill: Colour,
  out: RenderBatch[],
): void {
  const { area } = lane;
  const hairline = 1 / style.pixelRatio;
  const from = Math.max(area.x, pixelOf(style.viewport, range.start));
  const to = Math.min(area.x + area.width, pixelOf(style.viewport, range.end));
  const rectangles = pool.rectangles(fill);
  const edges = pool.rectangles(style.palette.selectionBorder);
  // A selection narrower than a pixel is drawn a pixel wide, so a single sample
  // selected at a coarse zoom is still seen.
  rectangles.add(from, area.y, Math.max(hairline, to - from), area.height);
  edges.add(from, area.y, hairline, area.height);
  edges.add(Math.max(from, to - hairline), area.y, hairline, area.height);
  out.push(rectangles.batch(), edges.batch());
}

function drawSelection(
  pool: BuilderPool,
  lane: Lane,
  overlay: LaneOverlay,
  style: OverlayStyle,
  out: RenderBatch[],
): void {
  const { selection } = overlay;
  const active = activeFacet(selection);
  if (!inScope(selection.channels, lane.channel)) return;
  if (selection.time !== undefined) {
    const fill =
      active === SelectionFacet.Time
        ? style.palette.selectionFill
        : style.palette.inactiveSelectionFill;
    wash(pool, style, lane, selection.time, fill, out);
  }
  const mask = selection.spectral;
  if (mask === undefined || lane.kind === 'waveform') return;
  const colour =
    active === SelectionFacet.Spectral ? style.palette.selectionBorder : style.palette.quietText;
  const outline = pool.segments(colour, 1.5);
  const x = (position: number): number => pixelOf(style.viewport, position);
  const y = (frequency: number): number => frequencyY(lane, frequency, overlay.spectral);
  // Each shape is outlined as it was drawn: a rectangle's edges, a lasso's
  // closed path and a brush's path, so a shape taken from the mask is seen
  // where it was taken.
  for (const shape of mask.shapes) {
    if (shape.kind === 'rectangle') {
      const x0 = x(shape.range.start);
      const x1 = x(shape.range.end);
      const y0 = y(shape.band.high);
      const y1 = y(shape.band.low);
      outline.add(x0, y0, x1, y0);
      outline.add(x1, y0, x1, y1);
      outline.add(x1, y1, x0, y1);
      outline.add(x0, y1, x0, y0);
      continue;
    }
    const { points } = shape;
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1];
      const to = points[index];
      if (from === undefined || to === undefined) continue;
      outline.add(x(from.position), y(from.frequency), x(to.position), y(to.frequency));
    }
    if (shape.kind === 'polygon') {
      const [first] = points;
      const last = points[points.length - 1] ?? first;
      outline.add(x(last.position), y(last.frequency), x(first.position), y(first.frequency));
    }
  }
  out.push(outline.batch());
}

function drawContent(
  pool: BuilderPool,
  lane: Lane,
  overlay: LaneOverlay,
  style: OverlayStyle,
  out: RenderBatch[],
): void {
  const regions = pool.rectangles(style.palette.region);
  const loops = pool.rectangles(style.palette.loop);
  for (const region of overlay.regions) {
    across(regions, style, lane, region.start);
    across(regions, style, lane, region.start + region.length);
    if (region.loop !== undefined) {
      across(loops, style, lane, region.start + region.loop.loopStart, 2);
      across(loops, style, lane, region.start + region.loop.loopEnd, 2);
    }
  }
  const markers = pool.rectangles(style.palette.marker);
  for (const marker of overlay.markers) across(markers, style, lane, marker.position);
  out.push(regions.batch(), loops.batch(), markers.batch());
}

function drawPreview(
  pool: BuilderPool,
  lane: Lane,
  preview: ToolPreview | undefined,
  style: OverlayStyle,
  out: RenderBatch[],
): void {
  switch (preview?.kind) {
    case 'time-range':
      if (inScope(preview.channels, lane.channel)) {
        wash(pool, style, lane, preview.range, style.palette.selectionFill, out);
      }
      break;
    case 'zoom-range': {
      const outline = pool.rectangles(style.palette.selectionBorder);
      across(outline, style, lane, preview.range.start);
      across(outline, style, lane, preview.range.end);
      out.push(outline.batch());
      break;
    }
    case 'razor':
    case 'marker':
    case 'region-boundary': {
      const guide = pool.rectangles(style.palette.snap);
      across(guide, style, lane, preview.position);
      out.push(guide.batch());
      break;
    }
    case undefined:
      break;
  }
}

/** Draws a lane's grid, selection, content, preview and playhead. */
export function drawLaneOverlay(
  pool: BuilderPool,
  lane: Lane,
  overlay: LaneOverlay,
  style: OverlayStyle,
  out: RenderBatch[],
): void {
  if (overlay.grid !== undefined) {
    const grid = pool.rectangles(style.palette.grid);
    for (const position of overlay.grid) across(grid, style, lane, position);
    out.push(grid.batch());
  }
  drawSelection(pool, lane, overlay, style, out);
  drawContent(pool, lane, overlay, style, out);
  drawPreview(pool, lane, overlay.preview, style, out);
  if (overlay.playhead !== undefined) {
    const playhead = pool.rectangles(style.palette.playhead);
    across(playhead, style, lane, overlay.playhead);
    out.push(playhead.batch());
  }
}
