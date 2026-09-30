/**
 * Drawing the ruler and the strip above the lanes: the ruler's ticks and
 * labels, the playhead's handle and the target a drag snapped to; the strip's
 * region spans and marker flags, each with its name.
 */

import type { Marker, MarkerId, Region } from '@audiogubbins/domain';
import type { RenderBatch, TextLabel } from '@audiogubbins/renderer';
import {
  pixelOf,
  type RulerTicks,
  type SnapTarget,
  type ViewportState,
} from '@audiogubbins/timeline';

import type { BuilderPool } from './batch-buffers.js';
import type { EditorPalette, EditorType } from './editor-palette.js';
import type { ViewLayout } from './lane-layout.js';
import type { ToolPreview } from './pointer-tools.js';

/** What the drawing reads of the view. */
export interface OverlayStyle {
  readonly viewport: ViewportState;
  readonly pixelRatio: number;
  readonly palette: EditorPalette;
  readonly type: EditorType;
}

/** The CSS pixel boundary `position` is drawn at, on a device pixel, or `undefined` out of view. */
export function crispX(style: OverlayStyle, position: number, width: number): number | undefined {
  const x = Math.round(pixelOf(style.viewport, position) * style.pixelRatio) / style.pixelRatio;
  return x < -1 || x > width + 1 ? undefined : x;
}

function label(
  style: OverlayStyle,
  text: string,
  x: number,
  y: number,
  baseline: TextLabel['baseline'],
  colour: TextLabel['colour'],
): TextLabel {
  return {
    text,
    x,
    y,
    colour,
    font: style.type.small,
    align: 'left',
    baseline,
  };
}

/** Draws the ruler: its ticks and labels, the playhead's handle and the snapped target. */
export function drawRuler(
  pool: BuilderPool,
  layout: ViewLayout,
  ticks: RulerTicks,
  style: OverlayStyle,
  marks: { readonly playhead: number | undefined; readonly snap: SnapTarget | undefined },
  out: RenderBatch[],
): void {
  const { ruler } = layout;
  const hairline = 1 / style.pixelRatio;
  const background = pool.rectangles(style.palette.rulerBackground);
  background.add(ruler.x, ruler.y, ruler.width, ruler.height);
  const tickMarks = pool.rectangles(style.palette.rulerTick);
  const labels: TextLabel[] = [];
  for (const tick of ticks.major) {
    const x = crispX(style, tick.position, ruler.width);
    if (x === undefined) continue;
    tickMarks.add(x, ruler.y + ruler.height / 2, hairline, ruler.height / 2);
    labels.push(label(style, tick.label, x + 3, ruler.y + 2, 'top', style.palette.rulerText));
  }
  for (const tick of ticks.minor) {
    const x = crispX(style, tick, ruler.width);
    if (x !== undefined)
      tickMarks.add(x, ruler.y + (ruler.height * 3) / 4, hairline, ruler.height / 4);
  }
  const handle = pool.rectangles(style.palette.playhead);
  const playheadX =
    marks.playhead === undefined ? undefined : crispX(style, marks.playhead, ruler.width);
  if (playheadX !== undefined) handle.add(playheadX - 4, ruler.y + ruler.height - 6, 9, 6);
  const snap = pool.rectangles(style.palette.snap);
  const snapX =
    marks.snap === undefined ? undefined : crispX(style, marks.snap.position, ruler.width);
  if (snapX !== undefined) snap.add(snapX - 1, ruler.y, 3, ruler.height);
  out.push(background.batch(), tickMarks.batch(), handle.batch(), snap.batch(), {
    kind: 'text',
    labels,
  });
}

/**
 * How wide a label of `text` is taken to be in CSS pixels: its length at an
 * average glyph width for the font's size. The view has no canvas to measure
 * text with, and a label need only be known not to reach the next.
 */
function labelWidth(text: string, font: string): number {
  const size = Number.parseFloat(font);
  return text.length * (Number.isFinite(size) ? size : 11) * 0.6;
}

/**
 * The labels among `labels` that do not run into the one before them, in
 * order along the strip: where two marks are closer than a name is long, the
 * later name is left out and its mark is still drawn, so no name is written
 * over another at a zoom that crowds them.
 */
function spacedLabels(labels: readonly TextLabel[]): TextLabel[] {
  const kept: TextLabel[] = [];
  let reach = -Infinity;
  for (const each of labels.toSorted((one, other) => one.x - other.x)) {
    if (each.x < reach) continue;
    kept.push(each);
    reach = each.x + labelWidth(each.text, each.font) + 4;
  }
  return kept;
}

/** Draws the strip: region spans with their names, and marker flags with theirs. */
export function drawStrip(
  pool: BuilderPool,
  layout: ViewLayout,
  content: { readonly markers: readonly Marker[]; readonly regions: readonly Region[] },
  selectedMarkers: ReadonlySet<MarkerId>,
  preview: ToolPreview | undefined,
  style: OverlayStyle,
  out: RenderBatch[],
): void {
  const { strip } = layout;
  const middle = strip.y + strip.height / 2;
  const spans = pool.rectangles(style.palette.region);
  const flags = pool.rectangles(style.palette.marker);
  const chosen = pool.rectangles(style.palette.selectedMarker);
  const labels: TextLabel[] = [];
  for (const region of content.regions) {
    const from = Math.max(0, pixelOf(style.viewport, region.start));
    const to = Math.min(strip.width, pixelOf(style.viewport, region.start + region.length));
    if (to <= from) continue;
    spans.add(from, strip.y, to - from, strip.height);
    labels.push(label(style, region.displayName, from + 4, middle, 'middle', style.palette.text));
  }
  for (const marker of content.markers) {
    const moving = preview?.kind === 'marker' && preview.id === marker.id;
    const x = pixelOf(style.viewport, moving ? preview.position : marker.position);
    if (x < -8 || x > strip.width + 8) continue;
    (selectedMarkers.has(marker.id) ? chosen : flags).add(x - 1, strip.y, 7, strip.height);
    labels.push(label(style, marker.displayName, x + 9, middle, 'middle', style.palette.text));
  }
  out.push(spans.batch(), flags.batch(), chosen.batch(), {
    kind: 'text',
    labels: spacedLabels(labels),
  });
}
