/**
 * Drawing what lies over a lane: the grid, the selection, the regions, loop
 * points and markers, what a drag shows before it is committed, and the
 * playhead.
 *
 * A kept selection is always drawn (REQ-EDIT-064): the active facet in the
 * selection colour, one kept but not active in a quieter wash, so a range the
 * person made earlier is never a surprise. A time range narrowed to some
 * channels washes only their lanes (REQ-EDIT-063). A spectral selection is
 * drawn on a lane that shows a spectrogram as its mask's weight with each shape
 * outlined (`mask-drawing.ts`), and while a spectral tool is dragged, as the
 * selection its shape would leave. The spectral edits of the asset are outlined
 * beneath it in a colour of their own, where the view's overlays include them.
 * A shape being drawn from the keyboard is drawn in its channel's spectrogram
 * as the path through the points placed to the cursor, with a guide across the
 * lane at the cursor's height, so the person sees what the points make.
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
import type { DrawingMarks } from './keyboard-drawing.js';
import type { Lane } from './lane-layout.js';
import { outlineMask, type MaskPainter, type SpectralEditOutline } from './mask-drawing.js';
import type { ToolPreview } from './tool-values.js';
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
  /** The asset's spectral edits to outline, none where the overlay is off. */
  readonly spectralEdits: readonly SpectralEditOutline[];
  /** A spectral shape being drawn from the keyboard, if one is. */
  readonly drawing: DrawingMarks | undefined;
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

/** Where `lane` draws a position and a frequency. */
function placing(
  lane: Lane,
  overlay: LaneOverlay,
  style: OverlayStyle,
): readonly [(position: number) => number, (frequency: number) => number] {
  return [
    (position) => pixelOf(style.viewport, position),
    (frequency) => frequencyY(lane, frequency, overlay.spectral),
  ];
}

function drawSpectralEdits(
  pool: BuilderPool,
  lane: Lane,
  overlay: LaneOverlay,
  style: OverlayStyle,
  out: RenderBatch[],
): void {
  if (lane.kind === 'waveform' || overlay.spectralEdits.length === 0) return;
  const outline = pool.segments(style.palette.spectralEdit, 1);
  const [, y] = placing(lane, overlay, style);
  for (const edit of overlay.spectralEdits) {
    if (!inScope(edit.channels, lane.channel)) continue;
    const x = (position: number): number => pixelOf(style.viewport, edit.from + position);
    outlineMask(outline, edit.mask, x, y);
  }
  out.push(outline.batch());
}

function drawSelection(
  pool: BuilderPool,
  masks: MaskPainter,
  lane: Lane,
  overlay: LaneOverlay,
  style: OverlayStyle,
  out: RenderBatch[],
): void {
  // While a spectral tool is dragged, the selection is drawn as its shape,
  // let go, would leave it.
  const selection =
    overlay.preview?.kind === 'spectral-shape' ? overlay.preview.selection : overlay.selection;
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
  const spectralActive = active === SelectionFacet.Spectral;
  masks.draw(
    lane,
    mask,
    overlay.spectral,
    style,
    spectralActive ? style.palette.selectionFill : style.palette.inactiveSelectionFill,
    out,
  );
  const outline = pool.segments(
    spectralActive ? style.palette.selectionBorder : style.palette.quietText,
    1.5,
  );
  outlineMask(outline, mask, ...placing(lane, overlay, style));
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
    case 'spectral-shape':
      // Drawn as the selection it would leave, with the selection.
      break;
    case undefined:
      break;
  }
}

/** How far each side of a placed point or the cursor its mark reaches, in CSS pixels. */
const MARK_REACH = 3;

/** The keyboard's drawing, in the spectrogram lane of its channel. */
function drawDrawing(
  pool: BuilderPool,
  lane: Lane,
  drawing: DrawingMarks | undefined,
  style: OverlayStyle,
  out: RenderBatch[],
): void {
  if (drawing?.channel !== lane.channel || lane.kind === 'waveform') {
    return;
  }
  const path = pool.segments(style.palette.snap, 1.5);
  const marks = pool.rectangles(style.palette.snap);
  const { area } = lane;
  let last: DrawingMarks['cursor'] | undefined;
  for (const point of [...drawing.points, drawing.cursor]) {
    if (last !== undefined) path.add(last.x, last.y, point.x, point.y);
    marks.add(point.x - MARK_REACH, point.y - MARK_REACH, 2 * MARK_REACH, 2 * MARK_REACH);
    last = point;
  }
  marks.add(area.x, drawing.cursor.y, area.width, 1 / style.pixelRatio);
  out.push(path.batch(), marks.batch());
}

/** Draws a lane's grid, spectral edits, selection, content, preview and playhead. */
export function drawLaneOverlay(
  pool: BuilderPool,
  masks: MaskPainter,
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
  drawSpectralEdits(pool, lane, overlay, style, out);
  drawSelection(pool, masks, lane, overlay, style, out);
  drawContent(pool, lane, overlay, style, out);
  drawPreview(pool, lane, overlay.preview, style, out);
  drawDrawing(pool, lane, overlay.drawing, style, out);
  if (overlay.playhead !== undefined) {
    const playhead = pool.rectangles(style.palette.playhead);
    across(playhead, style, lane, overlay.playhead);
    out.push(playhead.batch());
  }
}
