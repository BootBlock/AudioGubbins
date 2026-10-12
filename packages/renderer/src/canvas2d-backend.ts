/**
 * The reduced backend: geometry drawn with Canvas 2D, for a browser or a device
 * that offers neither WebGPU nor WebGL2 (REQ-AUDIO-152). Slower on a dense
 * frame, and complete: it draws everything the GPU backends draw, a field by an
 * image composed on a canvas it is handed (`canvas-fields.ts`). A browser that
 * loses a 2D context says so with `contextlost` and gives it back with
 * `contextrestored`, after which the latest frame is drawn again.
 */

import { FailureKind, fail, failure, succeed } from '@audiogubbins/domain';

import { CanvasFields } from './canvas-fields.js';
import {
  clipped,
  cssColour,
  paintRectangles,
  paintSegments,
  prepare,
  type Painter,
} from './canvas-painting.js';
import { FieldLookups, paints } from './field-pixels.js';
import type { RenderFrame, RenderLayer } from './render-frame.js';
import {
  AWAY,
  DRAWN,
  RendererKind,
  drawFailed,
  type BackendFactory,
  type DrawOutcome,
  type RendererBackend,
} from './renderer-backend.js';

class Canvas2dBackend implements RendererBackend {
  readonly kind = RendererKind.Canvas2d;
  readonly #painter: Painter;
  readonly #fields: CanvasFields;
  readonly #lookups = new FieldLookups();
  #lost = false;

  constructor(painter: Painter, fields: CanvasFields) {
    this.#painter = painter;
    this.#fields = fields;
  }

  set lost(value: boolean) {
    this.#lost = value;
  }

  draw(frame: RenderFrame): DrawOutcome {
    if (this.#lost) return AWAY;
    const painter = this.#painter;
    prepare(painter, frame);
    painter.fillStyle = cssColour(frame.clear);
    painter.fillRect(0, 0, frame.width, frame.height);
    const lookups = this.#lookups.pack(frame);
    let fieldIndex = 0;
    for (const layer of frame.layers) {
      const batches = layer.batches;
      let index = 0;
      while (index < batches.length) {
        const batch = batches[index];
        if (batch?.kind === 'field') {
          const placement = lookups.placements[fieldIndex];
          fieldIndex += 1;
          index += 1;
          // Outside the layer's clip, whose edge would shade a pixel it
          // crosses: the span is already within it by pixel centres.
          if (
            placement !== undefined &&
            paints(placement) &&
            !this.#fields.paint(painter, placement, lookups.values)
          ) {
            return drawFailed('The browser gave no Canvas 2D context to compose a field on.');
          }
          continue;
        }
        index = this.#paintGeometry(layer, index);
      }
    }
    return DRAWN;
  }

  /** Paints the layer's geometry from `from` up to its next field, within its clip; answers where it stopped. */
  #paintGeometry(layer: RenderLayer, from: number): number {
    const painter = this.#painter;
    let end = from;
    while (end < layer.batches.length && layer.batches[end]?.kind !== 'field') end += 1;
    clipped(painter, layer.clip, () => {
      for (let index = from; index < end; index += 1) {
        const batch = layer.batches[index];
        if (batch?.kind === 'rectangles') paintRectangles(painter, batch);
        else if (batch?.kind === 'segments') paintSegments(painter, batch);
      }
    });
    return end;
  }

  dispose(): void {
    this.#lost = true;
  }
}

/**
 * The Canvas 2D backend's factory, which composes fields on a canvas from
 * `offscreen`, one that is never shown, asked for when it first draws one.
 */
export function canvas2dBackend(offscreen: () => HTMLCanvasElement): BackendFactory {
  return {
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
      const backend = new Canvas2dBackend(painter, new CanvasFields(offscreen));
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
}
