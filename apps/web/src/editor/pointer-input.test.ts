import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_GESTURE_SETTINGS, type PointerSample } from '@audiogubbins/input';

import type { IntentCommand } from './intent-commands.js';
import { listenToPointers, type PointerRoutes } from './pointer-input.js';

/**
 * What the pointer events on a view mean, read from the browser's own event
 * types: which press is the tool's, when a press held still is the context
 * action, and what the wheel and a trackpad's pinch run.
 */

/** The surface: 800 by 200 CSS pixels, its top-left corner at (100, 50) of the page. */
const LEFT = 100;
const TOP = 50;

let target: HTMLElement;
let calls: string[];
let ran: IntentCommand[];
let opened: (readonly [number, number])[];
let stop: () => void;

/** Each call the tool was given, as its name, the pointer's kind and its identity. */
function said(name: string): (sample: PointerSample) => void {
  return (sample) => {
    calls.push(`${name} ${sample.kind} ${String(sample.pointerId)}`);
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  target = document.createElement('div');
  target.getBoundingClientRect = () => new DOMRect(LEFT, TOP, 800, 200);
  target.setPointerCapture = () => undefined;
  document.body.append(target);
  calls = [];
  ran = [];
  opened = [];
  const routes: PointerRoutes = {
    panel: 'editor',
    tool: {
      down: said('down'),
      moved: said('moved'),
      up: said('up'),
      cancel: () => {
        calls.push('cancel');
      },
    },
    run: (command) => {
      ran.push(command);
    },
    focus: () => undefined,
    contextActions: (x, y) => {
      opened.push([x, y]);
    },
  };
  stop = listenToPointers(target, routes);
});

afterEach(() => {
  stop();
  target.remove();
  vi.useRealTimers();
});

/** A pointer event of `type` from a `kind` of pointer, at a point of the page. */
function pointer(
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  kind: 'mouse' | 'pen' | 'touch',
  id: number,
  at: { readonly x: number; readonly y: number },
  pressure = 0.5,
): PointerEvent {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerType: kind,
    pointerId: id,
    clientX: at.x,
    clientY: at.y,
    pressure,
    button: 0,
  });
  target.dispatchEvent(event);
  return event;
}

describe('a pen with fingers on the screen (REQ-UX-067)', () => {
  it('keeps its press when a palm comes down during it', () => {
    // One touch replaced the pen's press and a second cancelled it; every pen
    // move and the release after that went nowhere.
    pointer('pointerdown', 'pen', 1, { x: 200, y: 100 });
    pointer('pointermove', 'pen', 1, { x: 220, y: 100 });
    pointer('pointerdown', 'touch', 2, { x: 600, y: 200 });
    pointer('pointerdown', 'touch', 3, { x: 650, y: 210 });
    pointer('pointermove', 'touch', 3, { x: 700, y: 230 });
    pointer('pointermove', 'pen', 1, { x: 300, y: 100 });
    pointer('pointerup', 'touch', 2, { x: 600, y: 200 });
    pointer('pointercancel', 'touch', 3, { x: 700, y: 230 });
    pointer('pointerup', 'pen', 1, { x: 300, y: 100 });

    expect(calls).toEqual(['down pen 1', 'moved pen 1', 'moved pen 1', 'up pen 1']);
    expect(ran).toEqual([]);
  });

  it('takes the tool from a palm that was down first, and keeps it', () => {
    pointer('pointerdown', 'touch', 2, { x: 600, y: 200 });
    pointer('pointerdown', 'pen', 1, { x: 200, y: 100 });
    pointer('pointerdown', 'touch', 3, { x: 650, y: 210 });
    pointer('pointermove', 'touch', 2, { x: 640, y: 220 });
    pointer('pointermove', 'pen', 1, { x: 260, y: 100 });
    pointer('pointerup', 'pen', 1, { x: 260, y: 100 });

    expect(calls).toEqual(['down touch 2', 'cancel', 'down pen 1', 'moved pen 1', 'up pen 1']);
    expect(ran).toEqual([]);
  });

  it('still pans and pinches with two fingers where no pen is down', () => {
    pointer('pointerdown', 'touch', 2, { x: 300, y: 100 });
    pointer('pointerdown', 'touch', 3, { x: 500, y: 100 });
    pointer('pointermove', 'touch', 3, { x: 700, y: 100 });

    expect(calls).toEqual(['down touch 2', 'cancel']);
    // The zoom is about where the midpoint was, the surface's 300, and the
    // scroll then carries the audio there to where it is, the surface's 400:
    // scrolled first, a view at the start of the asset stopped the half step
    // one finger's event makes, and the audio drifted from under the fingers.
    expect(ran).toEqual([
      { id: 'editor.zoom-by', args: { view: 'editor', factor: 0.5, anchor: 300 } },
      { id: 'editor.scroll', args: { view: 'editor', pixels: -100 } },
    ]);
  });
});

describe('a press held still (REQ-UX-067)', () => {
  const { longPressMs, longPressTolerancePx } = DEFAULT_GESTURE_SETTINGS;

  it('opens the context actions where a finger was held, through a jitter', () => {
    // The menu's own timer opened at 700 ms and was given up at the first move,
    // however small, so a hold of 600 ms, or one that shifted by a pixel,
    // abandoned the press and opened nothing.
    pointer('pointerdown', 'touch', 2, { x: 400, y: 120 });
    vi.advanceTimersByTime(200);
    pointer('pointermove', 'touch', 2, { x: 402, y: 121 });
    vi.advanceTimersByTime(longPressMs - 200);

    expect(opened).toEqual([[400, 120]]);
    expect(calls).toEqual(['down touch 2', 'moved touch 2', 'cancel']);
  });

  it('opens them for a pen held still, whose pressure moves it on the spot', () => {
    pointer('pointerdown', 'pen', 1, { x: 300, y: 100 }, 0.4);
    pointer('pointermove', 'pen', 1, { x: 300, y: 100 }, 0.5);
    pointer('pointermove', 'pen', 1, { x: 301, y: 100 }, 0.6);
    vi.advanceTimersByTime(longPressMs);

    expect(opened).toEqual([[300, 100]]);
  });

  it('opens them for a pen held still while a palm rests', () => {
    pointer('pointerdown', 'pen', 1, { x: 300, y: 100 });
    pointer('pointerdown', 'touch', 2, { x: 700, y: 220 });
    pointer('pointermove', 'touch', 2, { x: 720, y: 230 });
    vi.advanceTimersByTime(longPressMs);

    expect(opened).toEqual([[300, 100]]);
  });

  it('opens nothing for a press that moved further than the tolerance, or was let go', () => {
    pointer('pointerdown', 'touch', 2, { x: 400, y: 120 });
    pointer('pointermove', 'touch', 2, { x: 400 + longPressTolerancePx + 1, y: 120 });
    pointer('pointermove', 'touch', 2, { x: 400, y: 120 });
    vi.advanceTimersByTime(longPressMs);
    pointer('pointerup', 'touch', 2, { x: 400, y: 120 });

    pointer('pointerdown', 'pen', 1, { x: 300, y: 100 });
    vi.advanceTimersByTime(longPressMs - 1);
    pointer('pointerup', 'pen', 1, { x: 300, y: 100 });
    vi.advanceTimersByTime(longPressMs);

    expect(opened).toEqual([]);
    expect(calls).not.toContain('cancel');
  });

  it('opens nothing for a mouse, whose context action is its own button', () => {
    pointer('pointerdown', 'mouse', 1, { x: 300, y: 100 });
    vi.advanceTimersByTime(longPressMs * 2);

    expect(opened).toEqual([]);
  });
});

describe('the wheel and a trackpad’s pinch', () => {
  it('scrolls by the view’s width for a wheel read in pages', () => {
    // Firefox sends a page where the system scrolls a screen at a time, and it
    // was read as a single pixel.
    target.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: 1,
        deltaMode: WheelEvent.DOM_DELTA_PAGE,
        cancelable: true,
      }),
    );
    target.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: 3,
        deltaMode: WheelEvent.DOM_DELTA_LINE,
        cancelable: true,
      }),
    );

    expect(ran).toEqual([
      { id: 'editor.scroll', args: { view: 'editor', pixels: 800 } },
      { id: 'editor.scroll', args: { view: 'editor', pixels: 48 } },
    ]);
  });

  /** A WebKit gesture event of `type`, at `scale` of the pinch's start, over the page's x `x`. */
  function gesture(type: string, scale: number, x: number): Event {
    const event = new Event(type, { cancelable: true });
    Object.defineProperties(event, { scale: { value: scale }, clientX: { value: x } });
    target.dispatchEvent(event);
    return event;
  }

  it('zooms about the pointer with a pinch WebKit reports as a gesture, not the page', () => {
    const events = [
      gesture('gesturestart', 1, 500),
      gesture('gesturechange', 2, 500),
      gesture('gesturechange', 4, 500),
      gesture('gestureend', 4, 500),
    ];

    expect(ran).toEqual([
      { id: 'editor.zoom-by', args: { view: 'editor', factor: 0.5, anchor: 400 } },
      { id: 'editor.zoom-by', args: { view: 'editor', factor: 0.5, anchor: 400 } },
    ]);
    expect(events.every((event) => event.defaultPrevented)).toBe(true);
  });

  it('leaves a pinch of fingers on the screen to the pointer events', () => {
    // iPadOS reports a pinch both ways; taken twice, it would zoom twice.
    pointer('pointerdown', 'touch', 2, { x: 300, y: 100 });
    gesture('gesturestart', 1, 400);
    gesture('gesturechange', 2, 400);

    expect(ran.filter((command) => command.id === 'editor.zoom-by')).toEqual([]);
  });
});
