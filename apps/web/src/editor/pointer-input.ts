/**
 * The pointer events of an editor view, read through the input package into
 * what they mean (REQ-UX-005, REQ-UX-067): one pointer works the tool, two
 * fingers pan and pinch-zoom the view, the wheel scrolls and, with the primary
 * modifier, zooms. A right click and a long press are the context actions',
 * which the panel wraps the surface in; a pen is always the tool, however many
 * fingers rest on the screen.
 *
 * Nothing here changes the view itself: every gesture runs the command a key
 * or the palette would, named with this view.
 */

import {
  PointerKind,
  recogniseGesture,
  sampleFromPointerEvent,
  type PointerSample,
} from '@audiogubbins/input';

import type { IntentCommand } from './intent-commands.js';
import type { ToolPointer } from './tool-pointer.js';

/** How far one notch of a wheel read in lines moves, in CSS pixels. */
const LINE_PIXELS = 16;

/** How much a wheel's movement scales the zoom by, per CSS pixel. */
const WHEEL_ZOOM = 0.002;

/** What the pointer events are routed to. */
export interface PointerRoutes {
  readonly panel: string;
  readonly tool: ToolPointer;
  readonly run: (command: IntentCommand) => void;
  /** Gives the view the keyboard, as a press on it should. */
  readonly focus: () => void;
}

/** Two fingers' pan and pinch, as they move. */
interface TwoFingers {
  readonly started: readonly PointerSample[];
  lastDx: number;
  lastScale: number;
}

/** Runs the scroll and the zoom two fingers have made since they were last read. */
function twoFingersMoved(
  current: TwoFingers,
  touches: ReadonlyMap<number, PointerSample>,
  routes: PointerRoutes,
): void {
  const now = current.started.map((start) => touches.get(start.pointerId) ?? start);
  const gesture = recogniseGesture(current.started, now);
  const centre = (now[0]?.x ?? 0) / 2 + (now[1]?.x ?? 0) / 2;
  const dx = centre - ((current.started[0]?.x ?? 0) + (current.started[1]?.x ?? 0)) / 2;
  // Dragging right shows what is to the left, as the hand does.
  if (dx !== current.lastDx) {
    routes.run({ id: 'editor.scroll', args: { view: routes.panel, pixels: current.lastDx - dx } });
    current.lastDx = dx;
  }
  if (gesture.kind === 'zoom' && gesture.scale !== current.lastScale) {
    // Spreading the fingers zooms in: fewer samples to a pixel.
    routes.run({
      id: 'editor.zoom-by',
      args: {
        view: routes.panel,
        factor: current.lastScale / gesture.scale,
        anchor: gesture.centreX,
      },
    });
    current.lastScale = gesture.scale;
  }
}

/** The wheel over `target`: a scroll, or with the primary modifier, a zoom about the pointer. */
function wheelHandler(target: HTMLElement, routes: PointerRoutes): (event: WheelEvent) => void {
  return (event) => {
    event.preventDefault();
    const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? LINE_PIXELS : 1;
    const origin = target.getBoundingClientRect();
    if (event.ctrlKey || event.metaKey) {
      routes.run({
        id: 'editor.zoom-by',
        args: {
          view: routes.panel,
          factor: Math.exp(event.deltaY * scale * WHEEL_ZOOM),
          anchor: event.clientX - origin.left,
        },
      });
      return;
    }
    // A timeline scrolls sideways: a vertical wheel moves it as a sideways one does.
    const pixels = (event.deltaX !== 0 ? event.deltaX : event.deltaY) * scale;
    if (pixels !== 0) routes.run({ id: 'editor.scroll', args: { view: routes.panel, pixels } });
  };
}

/** The pointers on one view: the fingers down, and the two a pan and pinch is read from. */
class Pointers {
  readonly #target: HTMLElement;
  readonly #routes: PointerRoutes;
  readonly #touches = new Map<number, PointerSample>();
  #fingers: TwoFingers | undefined;

  constructor(target: HTMLElement, routes: PointerRoutes) {
    this.#target = target;
    this.#routes = routes;
  }

  #sampleOf(event: PointerEvent): PointerSample {
    return sampleFromPointerEvent(event, this.#target.getBoundingClientRect());
  }

  readonly down = (event: PointerEvent): void => {
    // The context button is the context actions', which the browser raises.
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    this.#routes.focus();
    this.#target.setPointerCapture(event.pointerId);
    const sample = this.#sampleOf(event);
    if (sample.kind === PointerKind.Touch) this.#touches.set(sample.pointerId, sample);
    if (this.#touches.size >= 2 && sample.kind === PointerKind.Touch) {
      // A second finger turns the press into a pan and a pinch.
      this.#routes.tool.cancel();
      this.#fingers = { started: [...this.#touches.values()].slice(0, 2), lastDx: 0, lastScale: 1 };
      return;
    }
    // A mouse press is kept from selecting the page's text. A finger's or a
    // pen's is left unhandled: the surface takes no touch gesture of the page
    // already, and the context actions' long press ignores a handled press.
    if (sample.kind === PointerKind.Mouse) event.preventDefault();
    this.#routes.tool.down(sample, modifiersOf(event));
  };

  readonly moved = (event: PointerEvent): void => {
    const sample = this.#sampleOf(event);
    if (this.#touches.has(sample.pointerId)) this.#touches.set(sample.pointerId, sample);
    if (this.#fingers !== undefined) {
      twoFingersMoved(this.#fingers, this.#touches, this.#routes);
      return;
    }
    this.#routes.tool.moved(sample, modifiersOf(event));
  };

  readonly up = (event: PointerEvent): void => {
    const sample = this.#sampleOf(event);
    this.#touches.delete(sample.pointerId);
    if (this.#fingers !== undefined) {
      if (this.#touches.size < 2) this.#fingers = undefined;
      return;
    }
    this.#routes.tool.up(sample, modifiersOf(event));
  };

  readonly cancelled = (event: PointerEvent): void => {
    this.#touches.delete(event.pointerId);
    if (this.#touches.size < 2) this.#fingers = undefined;
    this.#routes.tool.cancel();
  };
}

/** The modifiers a tool reads with a position. */
function modifiersOf(event: MouseEvent): { readonly shift: boolean; readonly alt: boolean } {
  return { shift: event.shiftKey, alt: event.altKey };
}

/** Listens to `target`'s pointer and wheel events, and gives back the function that stops. */
export function listenToPointers(target: HTMLElement, routes: PointerRoutes): () => void {
  const pointers = new Pointers(target, routes);
  const wheel = wheelHandler(target, routes);
  target.addEventListener('pointerdown', pointers.down);
  target.addEventListener('pointermove', pointers.moved);
  target.addEventListener('pointerup', pointers.up);
  target.addEventListener('pointercancel', pointers.cancelled);
  target.addEventListener('wheel', wheel, { passive: false });
  return () => {
    target.removeEventListener('pointerdown', pointers.down);
    target.removeEventListener('pointermove', pointers.moved);
    target.removeEventListener('pointerup', pointers.up);
    target.removeEventListener('pointercancel', pointers.cancelled);
    target.removeEventListener('wheel', wheel);
  };
}
