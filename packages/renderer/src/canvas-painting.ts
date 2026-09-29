/**
 * Drawing a frame's batches with a Canvas 2D context: the reduced backend's
 * geometry, and the text and images every backend draws above its geometry.
 *
 * Coordinates are CSS pixels, scaled once to device pixels, so what the
 * composer placed on a device pixel lands on one.
 */

import type {
  Colour,
  ImageBatch,
  Rectangle,
  RectangleBatch,
  RenderFrame,
  SegmentBatch,
  TextBatch,
} from './render-frame.js';
import { backingSize } from './render-frame.js';

/** The part of a Canvas 2D context the painting uses. */
export type Painter = Pick<
  CanvasRenderingContext2D,
  | 'canvas'
  | 'setTransform'
  | 'clearRect'
  | 'fillRect'
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'stroke'
  | 'save'
  | 'restore'
  | 'rect'
  | 'clip'
  | 'font'
  | 'textAlign'
  | 'textBaseline'
  | 'fillText'
  | 'drawImage'
>;

/** A channel from 0 to 1 as two hexadecimal digits. */
function hexadecimal(value: number): string {
  return Math.round(Math.min(1, Math.max(0, value)) * 255)
    .toString(16)
    .padStart(2, '0');
}

/**
 * A colour, which the view took from the theme's tokens, written as the CSS a
 * canvas reads: a conversion of notation, not a colour of its own.
 */
export function cssColour([red, green, blue, alpha]: Colour): string {
  return `#${hexadecimal(red)}${hexadecimal(green)}${hexadecimal(blue)}${hexadecimal(alpha)}`;
}

/** Sizes the canvas to the frame and sets the scale from CSS to device pixels. */
export function prepare(painter: Painter, frame: RenderFrame): void {
  const size = backingSize(frame);
  if (painter.canvas.width !== size.width) painter.canvas.width = size.width;
  if (painter.canvas.height !== size.height) painter.canvas.height = size.height;
  painter.setTransform(frame.pixelRatio, 0, 0, frame.pixelRatio, 0, 0);
}

/** Runs `draw` within `clip`, where one is given. */
export function clipped(painter: Painter, clip: Rectangle | undefined, draw: () => void): void {
  if (clip === undefined) {
    draw();
    return;
  }
  painter.save();
  painter.beginPath();
  painter.rect(clip.x, clip.y, clip.width, clip.height);
  painter.clip();
  draw();
  painter.restore();
}

export function paintRectangles(painter: Painter, batch: RectangleBatch): void {
  painter.fillStyle = cssColour(batch.colour);
  for (let index = 0; index < batch.count; index += 1) {
    const at = index * 4;
    painter.fillRect(
      batch.values[at] ?? 0,
      batch.values[at + 1] ?? 0,
      batch.values[at + 2] ?? 0,
      batch.values[at + 3] ?? 0,
    );
  }
}

export function paintSegments(painter: Painter, batch: SegmentBatch): void {
  painter.strokeStyle = cssColour(batch.colour);
  painter.lineWidth = batch.width;
  painter.beginPath();
  for (let index = 0; index < batch.count; index += 1) {
    const at = index * 4;
    painter.moveTo(batch.values[at] ?? 0, batch.values[at + 1] ?? 0);
    painter.lineTo(batch.values[at + 2] ?? 0, batch.values[at + 3] ?? 0);
  }
  painter.stroke();
}

const ALIGN = { left: 'left', centre: 'center', right: 'right' } as const;
const BASELINE = { top: 'top', middle: 'middle', bottom: 'bottom' } as const;

function paintText(painter: Painter, batch: TextBatch): void {
  for (const label of batch.labels) {
    painter.font = label.font;
    painter.fillStyle = cssColour(label.colour);
    painter.textAlign = ALIGN[label.align];
    painter.textBaseline = BASELINE[label.baseline];
    painter.fillText(label.text, label.x, label.y);
  }
}

function paintImages(painter: Painter, batch: ImageBatch): void {
  for (const placed of batch.images) {
    painter.drawImage(placed.image, placed.at.x, placed.at.y, placed.at.width, placed.at.height);
  }
}

/** Draws the frame's text and images, layer by layer, on a clear canvas above the geometry. */
export function paintOverlay(painter: Painter, frame: RenderFrame): void {
  prepare(painter, frame);
  painter.clearRect(0, 0, frame.width, frame.height);
  for (const layer of frame.layers) {
    const above = layer.batches.filter((batch) => batch.kind === 'text' || batch.kind === 'images');
    if (above.length === 0) continue;
    clipped(painter, layer.clip, () => {
      for (const batch of above) {
        if (batch.kind === 'images') paintImages(painter, batch);
      }
      for (const batch of above) {
        if (batch.kind === 'text') paintText(painter, batch);
      }
    });
  }
}
