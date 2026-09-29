/**
 * The reduced backend: geometry drawn with Canvas 2D, for a browser or a device
 * that offers neither WebGPU nor WebGL2 (REQ-AUDIO-152). Slower on a dense
 * frame, and complete: it draws everything the GPU backends draw. A browser
 * that loses a 2D context says so with `contextlost` and gives it back with
 * `contextrestored`, after which the latest frame is drawn again.
 */

import { FailureKind, fail, failure, succeed } from '@audiogubbins/domain';

import {
  clipped,
  cssColour,
  paintRectangles,
  paintSegments,
  prepare,
  type Painter,
} from './canvas-painting.js';
import type { RenderFrame } from './render-frame.js';
import { RendererKind, type BackendFactory, type RendererBackend } from './renderer-backend.js';

class Canvas2dBackend implements RendererBackend {
  readonly kind = RendererKind.Canvas2d;
  readonly #painter: Painter;
  #lost = false;

  constructor(painter: Painter) {
    this.#painter = painter;
  }

  set lost(value: boolean) {
    this.#lost = value;
  }

  draw(frame: RenderFrame): boolean {
    if (this.#lost) return false;
    const painter = this.#painter;
    prepare(painter, frame);
    painter.fillStyle = cssColour(frame.clear);
    painter.fillRect(0, 0, frame.width, frame.height);
    for (const layer of frame.layers) {
      clipped(painter, layer.clip, () => {
        for (const batch of layer.batches) {
          if (batch.kind === 'rectangles') paintRectangles(painter, batch);
          else if (batch.kind === 'segments') paintSegments(painter, batch);
        }
      });
    }
    return true;
  }

  dispose(): void {
    this.#lost = true;
  }
}

/** The Canvas 2D backend's factory. */
export const CANVAS_2D_BACKEND: BackendFactory = {
  kind: RendererKind.Canvas2d,
  create: (canvas, events) => {
    const painter = canvas.getContext('2d', { alpha: false });
    if (painter === null) {
      return Promise.resolve(
        fail(
          failure(
            'renderer.canvas-2d-unavailable',
            FailureKind.Unrecoverable,
            'The browser gave no Canvas 2D context.',
          ),
        ),
      );
    }
    const backend = new Canvas2dBackend(painter);
    canvas.addEventListener('contextlost', () => {
      backend.lost = true;
      events.lost('The browser took the Canvas 2D context away.');
    });
    canvas.addEventListener('contextrestored', () => {
      backend.lost = false;
      events.restored();
    });
    return Promise.resolve(succeed(backend));
  },
};
