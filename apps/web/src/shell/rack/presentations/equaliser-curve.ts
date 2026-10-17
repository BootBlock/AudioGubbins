/**
 * The parametric equaliser's response as it is drawn: across the audible
 * range on a logarithmic frequency axis, the gain of the bands that are on
 * (`equaliserResponse`, the very sections the processor runs), the chosen
 * band's own curve under it, and a handle for each band at its frequency and
 * gain, in its band's colour. A thumbnail draws the curve alone.
 */

import type { NumericParameterDescriptor, ParameterValues } from '@audiogubbins/domain';
import { EQUALISER_BANDS, equaliserResponse } from '@audiogubbins/processors';

import { canvasColour, scaleFont, type CurveDrawing } from './curve-canvas.js';

/** Each band's colour, in band order: the category colours, one a band. */
export const BAND_COLOURS: readonly string[] = [
  'coral',
  'amber',
  'lime',
  'teal',
  'sky',
  'indigo',
  'violet',
  'rose',
];

/** The audible range the axis spans, in hertz. */
const LOWEST = 20;
const HIGHEST = 20_000;

/** The gain either side of 0 dB the full graph spans, and where its guides are. */
const RANGE = 18;
const GUIDES = [-12, -6, 6, 12] as const;
const FREQUENCY_GUIDES = [50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000] as const;
const FREQUENCY_LABELS = [
  [100, '100'],
  [1_000, '1k'],
  [10_000, '10k'],
] as const;

/** The types whose handle stands at the band's gain: the others pass 0 dB at their frequency's side. */
const GAINED_TYPES: ReadonlySet<string> = new Set(['bell', 'low-shelf', 'high-shelf']);

/** What a full graph shows beyond the curve. */
export interface Chosen {
  /** The band whose own curve and ring are drawn, by its index. */
  readonly band: number;
}

/** The value of a band's parameter, or its default. */
function numberIn(values: ParameterValues, parameter: NumericParameterDescriptor): number {
  const value = values.get(parameter.id);
  return typeof value === 'number' ? value : parameter.defaultValue;
}

/** Where a frequency and a gain fall on the graph, and the points the curve is drawn through. */
interface Graph {
  readonly x: (frequency: number) => number;
  readonly y: (decibels: number) => number;
  /** A frequency a pixel along the axis. */
  readonly frequencies: Float64Array;
  /** The space between a guide and its label. */
  readonly pad: number;
}

/** The graph of `drawing`, its axis inset by `edge` at each end. */
function graphOf({ width, height, theme }: CurveDrawing, edge: number): Graph {
  const span = Math.log(HIGHEST / LOWEST);
  const pad = theme.metrics.grid.unit * 3;
  const points = Math.max(2, Math.round(width));
  const frequencies = new Float64Array(points);
  for (let index = 0; index < points; index += 1) {
    const along = Math.min(1, Math.max(0, (index - edge) / Math.max(1, width - 2 * edge)));
    frequencies[index] = LOWEST * (HIGHEST / LOWEST) ** along;
  }
  return {
    x: (frequency) => edge + (Math.log(frequency / LOWEST) / span) * (width - 2 * edge),
    y: (decibels) => height / 2 - (decibels / RANGE) * (height / 2 - pad),
    frequencies,
    pad,
  };
}

/** The guides at each octave's round frequencies and every 6 dB, the 0 dB line and the scale. */
function drawGuides(drawing: CurveDrawing, { x, y, pad }: Graph): void {
  const { context: g, width, height, theme } = drawing;
  const { waveform } = theme.palette;
  const line = (fromX: number, fromY: number, toX: number, toY: number): void => {
    g.beginPath();
    g.moveTo(fromX, fromY);
    g.lineTo(toX, toY);
    g.stroke();
  };
  g.lineWidth = 1;
  g.strokeStyle = canvasColour(waveform.grid);
  for (const frequency of FREQUENCY_GUIDES) {
    const at = Math.round(x(frequency)) + 0.5;
    line(at, 0, at, height);
  }
  for (const decibels of GUIDES) {
    const at = Math.round(y(decibels)) + 0.5;
    line(0, at, width, at);
  }
  g.strokeStyle = canvasColour(waveform.centreLine);
  line(0, Math.round(y(0)) + 0.5, width, Math.round(y(0)) + 0.5);
  g.fillStyle = canvasColour(waveform.labelSecondary);
  g.font = scaleFont(theme);
  g.textBaseline = 'alphabetic';
  for (const [frequency, label] of FREQUENCY_LABELS) {
    g.fillText(label, x(frequency) + pad, height - pad);
  }
  g.fillText('12', pad, y(12) - pad);
  g.fillText('−12', pad, y(-12) - pad);
}

/** A response drawn as a path through the graph's points. */
function pathOf(response: Float64Array, { y }: Graph): Path2D {
  const path = new Path2D();
  response.forEach((decibels, index) => {
    if (index === 0) path.moveTo(index, y(decibels));
    else path.lineTo(index, y(decibels));
  });
  return path;
}

/** A handle for each band in its colour at its frequency and gain, faint while off; the chosen one ringed. */
function drawHandles(
  drawing: CurveDrawing,
  values: ParameterValues,
  { x, y }: Graph,
  chosen: Chosen,
): void {
  const { context: g, theme } = drawing;
  const { analysis, category, chrome } = theme.palette;
  const radius = theme.metrics.grid.unit * 3.75;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `${String(theme.typeface.weight.bold)} ${String(theme.metrics.text.scale)}px ${theme.typeface.family.ui}`;
  EQUALISER_BANDS.forEach((band, index) => {
    const type = values.get(band.type.id);
    const gained = GAINED_TYPES.has(typeof type === 'string' ? type : band.type.defaultKey);
    const at = {
      x: x(numberIn(values, band.frequency)),
      y: y(gained ? numberIn(values, band.gain) : 0),
    };
    const colour = canvasColour(category[BAND_COLOURS[index] ?? 'teal'] ?? analysis.curve);
    g.globalAlpha = values.get(band.on.id) === true ? 1 : 0.45;
    if (index === chosen.band) {
      g.shadowColor = colour;
      g.shadowBlur = 12;
      g.strokeStyle = colour;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(at.x, at.y, radius * 1.45, 0, Math.PI * 2);
      g.stroke();
      g.shadowBlur = 0;
    }
    g.fillStyle = colour;
    g.beginPath();
    g.arc(at.x, at.y, radius, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = canvasColour(chrome.textOnAccent);
    g.fillText(String(index + 1), at.x, at.y + 0.5);
    g.globalAlpha = 1;
  });
}

/**
 * Draws the equaliser set by `values` at `sampleRate`: the whole graph, with
 * its guides, scale, chosen band and handles, where `chosen` is given, and the
 * curve alone, as a thumbnail, where it is not.
 */
export function drawEqualiser(
  drawing: CurveDrawing,
  values: ParameterValues,
  sampleRate: number,
  chosen?: Chosen,
): void {
  const { context: g, width, height, theme } = drawing;
  const { analysis, category } = theme.palette;
  // Inset by a handle's ring and glow, so no handle is cut at either end.
  const graph = graphOf(drawing, chosen === undefined ? 0 : theme.metrics.grid.unit * 8);
  const response = new Float64Array(graph.frequencies.length);
  equaliserResponse(values, sampleRate, graph.frequencies, response);
  if (chosen !== undefined) drawGuides(drawing, graph);

  const curve = pathOf(response, graph);
  const area = new Path2D(curve);
  area.lineTo(width, graph.y(0));
  area.lineTo(0, graph.y(0));
  area.closePath();
  const fill = g.createLinearGradient(0, 0, 0, height);
  fill.addColorStop(0, canvasColour(analysis.area));
  fill.addColorStop(0.5, canvasColour(analysis.area, 0));
  fill.addColorStop(1, canvasColour(analysis.area));
  g.fillStyle = fill;
  g.fill(area);

  if (chosen !== undefined) {
    // The chosen band's own curve, dashed in its colour under the whole.
    const own = new Float64Array(graph.frequencies.length);
    equaliserResponse(values, sampleRate, graph.frequencies, own, chosen.band);
    g.strokeStyle = canvasColour(
      category[BAND_COLOURS[chosen.band] ?? 'teal'] ?? analysis.curve,
      0.6,
    );
    g.setLineDash([graph.pad, graph.pad]);
    g.stroke(pathOf(own, graph));
    g.setLineDash([]);
  }

  g.shadowColor = canvasColour(analysis.curve);
  g.shadowBlur = chosen === undefined ? 6 : 10;
  g.strokeStyle = canvasColour(analysis.curve);
  g.lineWidth = chosen === undefined ? 1.5 : 2;
  g.stroke(curve);
  g.shadowBlur = 0;
  if (chosen !== undefined) drawHandles(drawing, values, graph, chosen);
}
