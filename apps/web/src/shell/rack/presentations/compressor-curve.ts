/**
 * The compressor's transfer curve as it is drawn: the level in across the
 * graph and the level out up it, both from −60 dB to 0 dB, the curve its
 * static gain makes of every steady level (`compressorTransfer`, the very
 * curve the processor runs), the unity line it leaves above its threshold,
 * and the threshold itself.
 */

import type { ParameterValues } from '@audiogubbins/domain';
import { COMPRESSOR_CURVE, compressorTransfer } from '@audiogubbins/processors';

import { canvasColour, scaleFont, type CurveDrawing } from './curve-canvas.js';

/** The quietest level the graph shows, in decibels; it runs from here to 0 dB. */
const FLOOR = -60;
const GUIDES = [-48, -36, -24, -12] as const;

/** Where a level falls across and up the graph. */
interface Graph {
  readonly x: (decibels: number) => number;
  readonly y: (decibels: number) => number;
  /** The space between a guide and its label. */
  readonly pad: number;
}

/** The guides every 12 dB, the unity line, the threshold and the scale on both axes. */
function drawGuides(drawing: CurveDrawing, values: ParameterValues, { x, y, pad }: Graph): void {
  const { context: g, width, height, theme } = drawing;
  const { analysis, waveform } = theme.palette;
  const line = (fromX: number, fromY: number, toX: number, toY: number): void => {
    g.beginPath();
    g.moveTo(fromX, fromY);
    g.lineTo(toX, toY);
    g.stroke();
  };
  g.lineWidth = 1;
  g.strokeStyle = canvasColour(waveform.grid);
  for (const decibels of GUIDES) {
    line(Math.round(x(decibels)) + 0.5, 0, Math.round(x(decibels)) + 0.5, height);
    line(0, Math.round(y(decibels)) + 0.5, width, Math.round(y(decibels)) + 0.5);
  }
  g.setLineDash([pad, pad]);
  g.strokeStyle = canvasColour(waveform.centreLine);
  line(0, height, width, 0);
  g.setLineDash([]);
  const threshold = values.get(COMPRESSOR_CURVE.threshold.id);
  const at =
    Math.round(
      x(typeof threshold === 'number' ? threshold : COMPRESSOR_CURVE.threshold.defaultValue),
    ) + 0.5;
  g.strokeStyle = canvasColour(analysis.threshold);
  line(at, 0, at, height);
  g.fillStyle = canvasColour(waveform.labelSecondary);
  g.font = scaleFont(theme);
  for (const decibels of GUIDES) {
    const label = `−${String(Math.abs(decibels))}`;
    g.fillText(label, x(decibels) + pad, height - pad);
    g.fillText(label, pad, y(decibels) - pad);
  }
}

/** Draws the compressor set by `values`. */
export function drawCompressor(drawing: CurveDrawing, values: ParameterValues): void {
  const { context: g, width, height, theme } = drawing;
  const { analysis } = theme.palette;
  const graph: Graph = {
    x: (decibels) => ((decibels - FLOOR) / -FLOOR) * width,
    y: (decibels) => height - ((decibels - FLOOR) / -FLOOR) * height,
    pad: theme.metrics.grid.unit * 2,
  };
  drawGuides(drawing, values, graph);

  // One point a pixel across the graph.
  const points = Math.max(2, Math.round(width));
  const levels = Float64Array.from(
    { length: points },
    (_, index) => FLOOR + (index / (points - 1)) * -FLOOR,
  );
  const out = new Float64Array(points);
  compressorTransfer(values, levels, out);
  const curve = new Path2D();
  levels.forEach((level, index) => {
    const point = { x: graph.x(level), y: graph.y(out[index] ?? level) };
    if (index === 0) curve.moveTo(point.x, point.y);
    else curve.lineTo(point.x, point.y);
  });
  const area = new Path2D(curve);
  area.lineTo(width, height);
  area.lineTo(0, height);
  area.closePath();
  const fill = g.createLinearGradient(0, 0, 0, height);
  fill.addColorStop(0, canvasColour(analysis.area));
  fill.addColorStop(1, canvasColour(analysis.area, 0));
  g.fillStyle = fill;
  g.fill(area);
  g.shadowColor = canvasColour(analysis.curve);
  g.shadowBlur = 10;
  g.strokeStyle = canvasColour(analysis.curve);
  g.lineWidth = 2;
  g.stroke(curve);
  g.shadowBlur = 0;
}
