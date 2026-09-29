/**
 * The pointer events of an editor view, read through the input package into
 * what they mean (REQ-UX-005, REQ-UX-067): one pointer works the tool, two
 * fingers pan and pinch-zoom the view, the wheel scrolls and, with the primary
 * modifier, zooms, as a trackpad's pinch does where the browser reports it as a
 * gesture of its own. A right click is the context actions', which the panel
 * wraps the surface in, and so is a finger or a pen held still, which is
 * recognised here, once, and opens them where it was held.
 *
 * A pen is always the tool, however many fingers rest on the screen: a touch
 * that arrives while a pen presses neither takes the press over nor cancels it,
 * and starts no pan or pinch of its own.
 *
 * Nothing here changes the view itself: every gesture runs the command a key or
 * the palette would, named with this view.
 */

import {
  DEFAULT_GESTURE_SETTINGS,
  PointerKind,
  recogniseGesture,
  sampleFromPointerEvent,
  type PointerSample,
} from '@audiogubbins/input';

import type { IntentCommand } from './intent-commands.js';
import type { Modifiers, ToolPointer } from './tool-pointer.js';

/** How far one notch of a wheel read in lines moves, in CSS pixels. */
const LINE_PIXELS = 16;

/** How much a wheel's movement scales the zoom by, per CSS pixel. */
const WHEEL_ZOOM = 0.002;

/** What the pointer events are routed to. */
export interface PointerRoutes {
  readonly panel: string;
  readonly tool: Pick<ToolPointer, 'down' | 'moved' | 'up' | 'cancel'>;
  readonly run: (command: IntentCommand) => void;
  /** Gives the view the keyboard, as a press on it should. */
  readonly focus: () => void;
  /** Opens the context actions at a point of the page, where a press was held still. */
  readonly contextActions: (clientX: number, clientY: number) => void;
}

/** Two fingers' pan and pinch, as they move. */
interface TwoFingers {
  readonly started: readonly PointerSample[];
  lastDx: number;
  lastScale: number;
}

/**
 * Runs the zoom and the scroll two fingers have made since they were last read,
 * so the audio that was under their midpoint is under it still.
 *
 * The zoom is about where the midpoint was, and the scroll then carries that
 * audio to where the midpoint is. A browser reports each finger's move as an
 * event of its own, so between two events of one spread the midpoint has moved
 * to one side; scrolled first, at a view fitted to the asset, that half step
 * was stopped at the start and its return was not, and the audio drifted from
 * under the fingers by a pixel or more at every step.
 */
function twoFingersMoved(
  current: TwoFingers,
  touches: ReadonlyMap<number, PointerSample>,
  routes: PointerRoutes,
): void {
  const now = current.started.map((start) => touches.get(start.pointerId) ?? start);
  const gesture = recogniseGesture(current.started, now);
  const started = ((current.started[0]?.x ?? 0) + (current.started[1]?.x ?? 0)) / 2;
  const dx = ((now[0]?.x ?? 0) + (now[1]?.x ?? 0)) / 2 - started;
  if (gesture.kind === 'zoom' && gesture.scale !== current.lastScale) {
    // Spreading the fingers zooms in: fewer samples to a pixel.
    routes.run({
      id: 'editor.zoom-by',
      args: {
        view: routes.panel,
        factor: current.lastScale / gesture.scale,
        anchor: started + current.lastDx,
      },
    });
    current.lastScale = gesture.scale;
  }
  // Dragging right shows what is to the left, as the hand does.
  if (dx !== current.lastDx) {
    routes.run({ id: 'editor.scroll', args: { view: routes.panel, pixels: current.lastDx - dx } });
    current.lastDx = dx;
  }
}

/**
 * How many CSS pixels one unit of a wheel's movement is: a line is a notch's
 * worth, and a page, which Firefox sends where the system scrolls a screen at a
 * time, the view's own width.
 */
function wheelUnit(event: WheelEvent, width: number): number {
  switch (event.deltaMode) {
    case WheelEvent.DOM_DELTA_LINE:
      return LINE_PIXELS;
    case WheelEvent.DOM_DELTA_PAGE:
      return width;
    default:
      return 1;
  }
}

/** The wheel over `target`: a scroll, or with the primary modifier, a zoom about the pointer. */
function wheelHandler(target: HTMLElement, routes: PointerRoutes): (event: WheelEvent) => void {
  return (event) => {
    event.preventDefault();
    const origin = target.getBoundingClientRect();
    const unit = wheelUnit(event, origin.width);
    if (event.ctrlKey || event.metaKey) {
      routes.run({
        id: 'editor.zoom-by',
        args: {
          view: routes.panel,
          factor: Math.exp(event.deltaY * unit * WHEEL_ZOOM),
          anchor: event.clientX - origin.left,
        },
      });
      return;
    }
    // A timeline scrolls sideways: a vertical wheel moves it as a sideways one does.
    const pixels = (event.deltaX !== 0 ? event.deltaX : event.deltaY) * unit;
    if (pixels !== 0) routes.run({ id: 'editor.scroll', args: { view: routes.panel, pixels } });
  };
}

/**
 * A number an event carries under `name`, read by name: WebKit's gesture events
 * are in no standard's type definitions.
 */
function numberOf(event: Event, name: string): number | undefined {
  const value: unknown = Reflect.get(event, name);
  return typeof value === 'number' ? value : undefined;
}

/**
 * A trackpad's pinch where WebKit reports it as a gesture, as Safari on a Mac
 * does, rather than as a wheel with Control held: a zoom about the pointer, by
 * the scale the pinch has reached since the last. The page's own zoom, which
 * would also change the pixel ratio the view is drawn at, is kept off it. An
 * engine that sends no such events never calls this.
 *
 * A pinch of two fingers on a touch screen is reported both ways on iPadOS, and
 * is the pointer events' while `touching` says a finger is down.
 */
function gestureHandler(
  target: HTMLElement,
  routes: PointerRoutes,
  touching: () => boolean,
): (event: Event) => void {
  let lastScale = 1;
  return (event) => {
    event.preventDefault();
    if (event.type === 'gesturestart') lastScale = 1;
    const scale = numberOf(event, 'scale');
    const x = numberOf(event, 'clientX');
    if (touching() || scale === undefined || x === undefined || scale <= 0) return;
    if (scale === lastScale) return;
    routes.run({
      id: 'editor.zoom-by',
      args: {
        view: routes.panel,
        factor: lastScale / scale,
        anchor: x - target.getBoundingClientRect().left,
      },
    });
    lastScale = scale;
  };
}

/** A finger or a pen pressed and kept near where it went down: a long press, if it stays. */
interface Held {
  readonly started: PointerSample;
  latest: PointerSample;
  /** Where on the page it went down, where the context actions open. */
  readonly clientX: number;
  readonly clientY: number;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * The pointers on one view: the fingers down, the two a pan and pinch is read
 * from, the pen whose press is the tool's, and the press that may be held.
 */
class Pointers {
  readonly #target: HTMLElement;
  readonly #routes: PointerRoutes;
  readonly #touches = new Map<number, PointerSample>();
  #fingers: TwoFingers | undefined;
  #pen: number | undefined;
  #held: Held | undefined;

  constructor(target: HTMLElement, routes: PointerRoutes) {
    this.#target = target;
    this.#routes = routes;
  }

  /** Whether a finger is on the view. */
  readonly touching = (): boolean => this.#touches.size > 0;

  #sampleOf(event: PointerEvent): PointerSample {
    return sampleFromPointerEvent(event, this.#target.getBoundingClientRect());
  }

  /** Whether a touch is a hand resting while a pen works, which is left out. */
  #resting(sample: PointerSample): boolean {
    return sample.kind === PointerKind.Touch && this.#pen !== undefined;
  }

  readonly down = (event: PointerEvent): void => {
    // The context button is the context actions', which the browser raises.
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    this.#routes.focus();
    this.#target.setPointerCapture(event.pointerId);
    const sample = this.#sampleOf(event);
    if (sample.kind === PointerKind.Touch) this.#touches.set(sample.pointerId, sample);
    if (this.#resting(sample)) return;
    if (sample.kind === PointerKind.Pen) {
      // The pen takes the tool from the fingers, whatever they were doing.
      this.#pen = sample.pointerId;
      if (this.#touches.size > 0) this.#routes.tool.cancel();
      this.#fingers = undefined;
    } else if (sample.kind === PointerKind.Touch && this.#touches.size >= 2) {
      // A second finger turns the press into a pan and a pinch.
      this.#forgetHeld();
      this.#routes.tool.cancel();
      this.#fingers = { started: [...this.#touches.values()].slice(0, 2), lastDx: 0, lastScale: 1 };
      return;
    }
    // A mouse press is kept from selecting the page's text.
    if (sample.kind === PointerKind.Mouse) event.preventDefault();
    else this.#hold(sample, event);
    this.#routes.tool.down(sample, modifiersOf(event));
  };

  readonly moved = (event: PointerEvent): void => {
    const sample = this.#sampleOf(event);
    if (this.#touches.has(sample.pointerId)) this.#touches.set(sample.pointerId, sample);
    if (this.#resting(sample)) return;
    if (this.#fingers !== undefined && sample.kind === PointerKind.Touch) {
      twoFingersMoved(this.#fingers, this.#touches, this.#routes);
      return;
    }
    this.#strayed(sample);
    this.#routes.tool.moved(sample, modifiersOf(event));
  };

  readonly up = (event: PointerEvent): void => {
    const sample = this.#sampleOf(event);
    this.#touches.delete(sample.pointerId);
    this.#lifted(sample.pointerId);
    if (sample.pointerId === this.#pen) this.#pen = undefined;
    else if (this.#resting(sample)) return;
    else if (this.#fingers !== undefined && sample.kind === PointerKind.Touch) {
      if (this.#touches.size < 2) this.#fingers = undefined;
      return;
    }
    this.#routes.tool.up(sample, modifiersOf(event));
  };

  readonly cancelled = (event: PointerEvent): void => {
    this.#touches.delete(event.pointerId);
    this.#lifted(event.pointerId);
    if (event.pointerId === this.#pen) this.#pen = undefined;
    else if (event.pointerType === 'touch' && this.#pen !== undefined) return;
    if (this.#touches.size < 2) this.#fingers = undefined;
    this.#routes.tool.cancel();
  };

  /** Starts waiting to see whether a finger's or a pen's press is held. */
  #hold(sample: PointerSample, event: PointerEvent): void {
    this.#forgetHeld();
    this.#held = {
      started: sample,
      latest: sample,
      clientX: event.clientX,
      clientY: event.clientY,
      timer: setTimeout(this.#heldLong, DEFAULT_GESTURE_SETTINGS.longPressMs),
    };
  }

  /** Gives up the long press of a pointer that has moved further than one allows. */
  #strayed(sample: PointerSample): void {
    const held = this.#held;
    if (held?.started.pointerId !== sample.pointerId) return;
    held.latest = sample;
    const { x, y } = held.started;
    if (Math.hypot(sample.x - x, sample.y - y) > DEFAULT_GESTURE_SETTINGS.longPressTolerancePx) {
      this.#forgetHeld();
    }
  }

  /**
   * The long press's time is up: the recogniser reads the press as it stands,
   * at the moment the timer measured, and where it is the context action, the
   * tool's press is abandoned and the context actions open where it was held.
   */
  readonly #heldLong = (): void => {
    const held = this.#held;
    this.#held = undefined;
    if (held === undefined) return;
    const now = {
      ...held.latest,
      timestamp: held.started.timestamp + DEFAULT_GESTURE_SETTINGS.longPressMs,
    };
    if (recogniseGesture([held.started], [now]).kind !== 'context') return;
    this.#routes.tool.cancel();
    this.#routes.contextActions(held.clientX, held.clientY);
  };

  #lifted(pointerId: number): void {
    if (this.#held?.started.pointerId === pointerId) this.#forgetHeld();
  }

  #forgetHeld(): void {
    if (this.#held !== undefined) clearTimeout(this.#held.timer);
    this.#held = undefined;
  }

  dispose(): void {
    this.#forgetHeld();
  }
}

/** The modifiers a tool reads with a position. */
function modifiersOf(event: MouseEvent): Modifiers {
  return { shift: event.shiftKey, alt: event.altKey };
}

/** The gesture events WebKit reports a trackpad's pinch with. */
const GESTURES = ['gesturestart', 'gesturechange', 'gestureend'] as const;

/** Listens to `target`'s pointer, wheel and gesture events, and gives back the function that stops. */
export function listenToPointers(target: HTMLElement, routes: PointerRoutes): () => void {
  const pointers = new Pointers(target, routes);
  const wheel = wheelHandler(target, routes);
  const gesture = gestureHandler(target, routes, pointers.touching);
  target.addEventListener('pointerdown', pointers.down);
  target.addEventListener('pointermove', pointers.moved);
  target.addEventListener('pointerup', pointers.up);
  target.addEventListener('pointercancel', pointers.cancelled);
  target.addEventListener('wheel', wheel, { passive: false });
  for (const name of GESTURES) target.addEventListener(name, gesture);
  return () => {
    target.removeEventListener('pointerdown', pointers.down);
    target.removeEventListener('pointermove', pointers.moved);
    target.removeEventListener('pointerup', pointers.up);
    target.removeEventListener('pointercancel', pointers.cancelled);
    target.removeEventListener('wheel', wheel);
    for (const name of GESTURES) target.removeEventListener(name, gesture);
    pointers.dispose();
  };
}
