/**
 * Field batches on Canvas 2D (ADR-0082): each field mapped on the processor,
 * through the column and row maps every backend draws by (`field-pixels.ts`),
 * into an image of the device pixels it paints, and drawn over the geometry
 * from a canvas that is never shown. Putting an image on the geometry's canvas
 * would replace what is there rather than blend over it, so the image is
 * composed off screen and drawn, which blends.
 *
 * The browser can take the off-screen canvas's context away as it takes the
 * geometry's, in the same GPU process crash, and give the geometry's back
 * first: the backend then draws again at once, and an image composed on a
 * canvas still lost draws nothing. A canvas whose context is lost is let go,
 * and the next field asks for another, whose context is the browser's to give
 * at once.
 */

import type { Painter } from './canvas-painting.js';
import type { FieldPlacement } from './field-pixels.js';

/** The part of a Canvas 2D context a field's image is composed with. */
export type Composer = Pick<
  CanvasRenderingContext2D,
  'canvas' | 'createImageData' | 'putImageData'
>;

/**
 * What paints a backend's fields: its off-screen canvas, asked for once and
 * again only after its context is lost, and an image kept (G4).
 */
export class CanvasFields {
  readonly #offscreen: () => HTMLCanvasElement;
  /** Asked for on the first field: a backend that draws none makes no canvas. */
  #composer: Composer | null | undefined;
  #image: ImageData | undefined;

  constructor(offscreen: () => HTMLCanvasElement) {
    this.#offscreen = offscreen;
  }

  /**
   * Paints one placed field, whose maps are in `lookups`, on `painter`;
   * answers whether there was a canvas to compose it on.
   */
  paint(painter: Painter, placement: FieldPlacement, lookups: Float32Array): boolean {
    this.#composer ??= this.#compose();
    const composer = this.#composer;
    if (composer === null) return false;
    const { span } = placement;
    const image = this.#imageFor(composer, span.width, span.height);
    fill(image, placement, lookups);
    const canvas = composer.canvas;
    if (canvas.width < span.width) canvas.width = span.width;
    if (canvas.height < span.height) canvas.height = span.height;
    composer.putImageData(image, 0, 0, 0, 0, span.width, span.height);
    // In device pixels, one for one, so no pixel is resampled.
    painter.save();
    painter.setTransform(1, 0, 0, 1, 0, 0);
    painter.drawImage(
      canvas,
      0,
      0,
      span.width,
      span.height,
      span.left,
      span.top,
      span.width,
      span.height,
    );
    painter.restore();
    return true;
  }

  /** A new canvas's context, let go of when the browser takes it away. */
  #compose(): Composer | null {
    const canvas = this.#offscreen();
    const composer = canvas.getContext('2d');
    canvas.addEventListener(
      'contextlost',
      () => {
        if (this.#composer === composer) this.#composer = undefined;
      },
      { once: true },
    );
    return composer;
  }

  /** An image at least `width` by `height`, kept and grown as fields need. */
  #imageFor(composer: Composer, width: number, height: number): ImageData {
    const image = this.#image;
    if (image !== undefined && image.width >= width && image.height >= height) return image;
    const grown = composer.createImageData(
      Math.max(width, image?.width ?? 0),
      Math.max(height, image?.height ?? 0),
    );
    this.#image = grown;
    return grown;
  }
}

/** Writes the colours of the field's cells into `image`, from its top left, clear where it paints nothing. */
function fill(image: ImageData, placement: FieldPlacement, lookups: Float32Array): void {
  const { span, batch, columnsAt, rowsAt } = placement;
  const { values, width } = batch.field;
  const colours = batch.ramp.colours;
  const pixels = image.data;
  for (let y = 0; y < span.height; y += 1) {
    const row = lookups[rowsAt + y] ?? -1;
    const start = y * image.width * 4;
    if (row < 0) {
      pixels.fill(0, start, start + span.width * 4);
      continue;
    }
    for (let x = 0; x < span.width; x += 1) {
      const column = lookups[columnsAt + x] ?? -1;
      const at = start + x * 4;
      if (column < 0) {
        pixels.fill(0, at, at + 4);
        continue;
      }
      const colour = (values[row * width + column] ?? 0) * 4;
      pixels[at] = colours[colour] ?? 0;
      pixels[at + 1] = colours[colour + 1] ?? 0;
      pixels[at + 2] = colours[colour + 2] ?? 0;
      pixels[at + 3] = colours[colour + 3] ?? 0;
    }
  }
}
