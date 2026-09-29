/**
 * The two stacked canvases an editor view is drawn on: the geometry canvas,
 * which a GPU backend or the Canvas 2D backend draws the frame's rectangles
 * and segments on, and the overlay above it, where the frame's text and
 * picture thumbnails are drawn (ADR-0044).
 *
 * A canvas takes one kind of context for life, so each backend the renderer
 * tries is given a fresh geometry canvas, which takes the place of the one
 * before it under the overlay. Neither canvas is a control: the element that
 * holds them is the view's one focusable, labelled surface, and both are
 * hidden from assistive technology, which reads the view's state from the
 * readouts beside it (REQ-UX-005).
 */

import type { Painter, RenderSurface } from '@audiogubbins/renderer';

function stacked(canvas: HTMLCanvasElement, role: string): HTMLCanvasElement {
  canvas.className = `ag-editor-canvas ag-editor-canvas-${role}`;
  canvas.setAttribute('aria-hidden', 'true');
  return canvas;
}

/** The canvases of one view, inside `host`. */
export class EditorCanvases implements RenderSurface {
  readonly #host: HTMLElement;
  readonly #overlay: HTMLCanvasElement;
  #geometry: HTMLCanvasElement | undefined;
  /** Asked for once: a canvas answers the same context every time, or none. */
  #painter: Painter | null | undefined;

  constructor(host: HTMLElement) {
    this.#host = host;
    this.#overlay = stacked(host.ownerDocument.createElement('canvas'), 'overlay');
    host.append(this.#overlay);
  }

  /** The canvas pointer events arrive on: the overlay, which is above the geometry. */
  get pointerTarget(): HTMLCanvasElement {
    return this.#overlay;
  }

  freshCanvas(): HTMLCanvasElement {
    const canvas = stacked(this.#host.ownerDocument.createElement('canvas'), 'geometry');
    this.#geometry?.remove();
    this.#host.insertBefore(canvas, this.#overlay);
    this.#geometry = canvas;
    return canvas;
  }

  overlay(): Painter | undefined {
    this.#painter ??= this.#overlay.getContext('2d');
    return this.#painter ?? undefined;
  }

  /** Takes both canvases out of the page. */
  dispose(): void {
    this.#geometry?.remove();
    this.#overlay.remove();
  }
}
