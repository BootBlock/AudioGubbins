import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GESTURE_SETTINGS,
  PointerKind,
  recogniseGesture,
  toolStrength,
  sampleFromPointerEvent,
  type GestureSettings,
  type PointerReading,
  type PointerSample,
} from './pointer.js';

function sample(overrides: Partial<PointerSample> = {}): PointerSample {
  return {
    pointerId: 1,
    kind: PointerKind.Touch,
    x: 0,
    y: 0,
    timestamp: 0,
    ...overrides,
  };
}

describe('toolStrength', () => {
  const pressureOn = DEFAULT_GESTURE_SETTINGS;
  const pressureOff: GestureSettings = { ...DEFAULT_GESTURE_SETTINGS, usePenPressure: false };

  it('uses the pen pressure when pressure is on', () => {
    expect(toolStrength(sample({ kind: PointerKind.Pen, pressure: 0.3 }), pressureOn)).toBe(0.3);
  });

  it('uses the fixed strength when the user has turned pressure off', () => {
    // REQ-UX-068: a deterministic fixed strength stays available even on
    // pressure-capable hardware.
    expect(toolStrength(sample({ kind: PointerKind.Pen, pressure: 0.3 }), pressureOff)).toBe(
      pressureOff.fixedStrength,
    );
  });

  it('uses the fixed strength for a mouse, which reports no pressure', () => {
    // A tool that read the reported value would draw nothing for a mouse user.
    expect(toolStrength(sample({ kind: PointerKind.Mouse }), pressureOn)).toBe(
      pressureOn.fixedStrength,
    );
  });

  it('uses the fixed strength for a finger', () => {
    expect(toolStrength(sample({ kind: PointerKind.Touch }), pressureOn)).toBe(
      pressureOn.fixedStrength,
    );
  });

  it('uses the fixed strength for a pen that reports no pressure', () => {
    expect(toolStrength(sample({ kind: PointerKind.Pen }), pressureOn)).toBe(
      pressureOn.fixedStrength,
    );
  });

  it('honours a pen lifted to zero pressure, which is not the same as unreported', () => {
    expect(toolStrength(sample({ kind: PointerKind.Pen, pressure: 0 }), pressureOn)).toBe(0);
  });
});

describe('recogniseGesture', () => {
  it('reports nothing when no contact is down', () => {
    expect(recogniseGesture([], [])).toEqual({ kind: 'idle' });
  });

  it('treats one finger as the tool', () => {
    const started = [sample({ x: 10, y: 10 })];
    const current = [sample({ x: 20, y: 30, timestamp: 100 })];

    expect(recogniseGesture(started, current)).toEqual({ kind: 'tool', at: current[0] });
  });

  it('treats a still contact held long enough as the context action', () => {
    const started = [sample({ x: 10, y: 10, timestamp: 0 })];
    const current = [sample({ x: 12, y: 11, timestamp: 600 })];

    expect(recogniseGesture(started, current).kind).toBe('context');
  });

  it('does not treat a contact that moved as a long press', () => {
    const started = [sample({ x: 10, y: 10, timestamp: 0 })];
    const current = [sample({ x: 60, y: 10, timestamp: 600 })];

    expect(recogniseGesture(started, current).kind).toBe('tool');
  });

  it('does not fire a long press before its time', () => {
    const started = [sample({ x: 10, y: 10, timestamp: 0 })];
    const current = [sample({ x: 10, y: 10, timestamp: 400 })];

    expect(recogniseGesture(started, current).kind).toBe('tool');
  });

  it('fires a long press at its time exactly, and not a millisecond before', () => {
    const { longPressMs } = DEFAULT_GESTURE_SETTINGS;
    const started = [sample({ x: 10, y: 10, timestamp: 0 })];

    expect(recogniseGesture(started, [sample({ x: 10, y: 10, timestamp: longPressMs })]).kind).toBe(
      'context',
    );
    expect(
      recogniseGesture(started, [sample({ x: 10, y: 10, timestamp: longPressMs - 1 })]).kind,
    ).toBe('tool');
  });

  it('holds a contact moved by the tolerance exactly as still, and one moved further as moved', () => {
    const { longPressMs, longPressTolerancePx } = DEFAULT_GESTURE_SETTINGS;
    const started = [sample({ x: 10, y: 10, timestamp: 0 })];
    const movedBy = (distance: number) =>
      recogniseGesture(started, [sample({ x: 10 + distance, y: 10, timestamp: longPressMs })]).kind;

    expect(movedBy(longPressTolerancePx)).toBe('context');
    expect(movedBy(longPressTolerancePx + 1)).toBe('tool');
  });

  it('pans with two fingers held the same distance apart', () => {
    const started = [sample({ pointerId: 1, x: 0, y: 0 }), sample({ pointerId: 2, x: 100, y: 0 })];
    const current = [
      sample({ pointerId: 1, x: 50, y: 20 }),
      sample({ pointerId: 2, x: 150, y: 20 }),
    ];

    expect(recogniseGesture(started, current)).toEqual({ kind: 'pan', dx: 50, dy: 20 });
  });

  it('zooms when the fingers move apart', () => {
    const started = [sample({ pointerId: 1, x: 0, y: 0 }), sample({ pointerId: 2, x: 100, y: 0 })];
    const current = [sample({ pointerId: 1, x: 0, y: 0 }), sample({ pointerId: 2, x: 200, y: 0 })];

    const gesture = recogniseGesture(started, current);
    expect(gesture.kind).toBe('zoom');
    if (gesture.kind === 'zoom') {
      expect(gesture.scale).toBeCloseTo(2, 5);
      expect(gesture.centreX).toBe(100);
    }
  });

  it('zooms out when the fingers come together', () => {
    const started = [sample({ pointerId: 1, x: 0, y: 0 }), sample({ pointerId: 2, x: 200, y: 0 })];
    const current = [sample({ pointerId: 1, x: 0, y: 0 }), sample({ pointerId: 2, x: 100, y: 0 })];

    const gesture = recogniseGesture(started, current);
    expect(gesture.kind).toBe('zoom');
    if (gesture.kind === 'zoom') expect(gesture.scale).toBeCloseTo(0.5, 5);
  });

  it('does not treat a small wobble as a zoom, which would make panning jitter', () => {
    const started = [sample({ pointerId: 1, x: 0, y: 0 }), sample({ pointerId: 2, x: 100, y: 0 })];
    const current = [sample({ pointerId: 1, x: 10, y: 0 }), sample({ pointerId: 2, x: 111, y: 0 })];

    expect(recogniseGesture(started, current).kind).toBe('pan');
  });

  it('keeps the pen as the tool even with fingers also on the screen', () => {
    // A hand resting on the screen must not turn drawing into panning.
    const pen = sample({ pointerId: 3, kind: PointerKind.Pen, x: 40, y: 40, pressure: 0.5 });
    const started = [sample({ pointerId: 1, x: 0, y: 0 }), sample({ pointerId: 2, x: 100, y: 0 })];
    const current = [
      sample({ pointerId: 1, x: 0, y: 0 }),
      sample({ pointerId: 2, x: 200, y: 0 }),
      pen,
    ];

    expect(recogniseGesture(started, current)).toEqual({ kind: 'tool', at: pen });
  });

  it('treats a mouse as the tool, never as a pan', () => {
    const mouse = sample({ kind: PointerKind.Mouse, x: 5, y: 5 });
    expect(recogniseGesture([mouse], [mouse]).kind).toBe('tool');
  });

  it('gives the same answer for the same contacts, however often it is asked', () => {
    const started = [sample({ pointerId: 1, x: 0, y: 0 }), sample({ pointerId: 2, x: 100, y: 0 })];
    const current = [sample({ pointerId: 1, x: 0, y: 0 }), sample({ pointerId: 2, x: 180, y: 0 })];

    expect(recogniseGesture(started, current)).toEqual(recogniseGesture(started, current));
  });

  it('reports nothing rather than guessing when the starting contacts are missing', () => {
    const current = [sample({ pointerId: 1, x: 0, y: 0 }), sample({ pointerId: 2, x: 100, y: 0 })];
    expect(recogniseGesture([], current).kind).toBe('idle');
  });
});

/**
 * The one place a browser event becomes an AudioGubbins value.
 *
 * Held here as every other export of this module is: this is the one an editing
 * canvas will call on every pointer move.
 */
describe('sampleFromPointerEvent', () => {
  /** A reading, in the shape a browser's pointer event has. */
  function event(overrides: Partial<PointerReading> = {}): PointerReading {
    return {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 120,
      clientY: 80,
      pressure: 0.5,
      timeStamp: 1_000,
      ...overrides,
    };
  }

  const origin = { left: 20, top: 10 };

  it('reads the position in the coordinates of the element, not the page', () => {
    const sample = sampleFromPointerEvent(event(), origin);

    expect(sample.x).toBe(100);
    expect(sample.y).toBe(70);
    expect(sample.timestamp).toBe(1_000);
    expect(sample.pointerId).toBe(1);
  });

  it('names each kind of pointer the browser reports', () => {
    expect(sampleFromPointerEvent(event({ pointerType: 'pen' }), origin).kind).toBe(
      PointerKind.Pen,
    );
    expect(sampleFromPointerEvent(event({ pointerType: 'touch' }), origin).kind).toBe(
      PointerKind.Touch,
    );
    expect(sampleFromPointerEvent(event({ pointerType: 'mouse' }), origin).kind).toBe(
      PointerKind.Mouse,
    );
  });

  it('treats a kind it has never heard of as a mouse, rather than refusing the press', () => {
    // A browser may report anything here, and an unusable pointer is worse than
    // one treated as the commonest kind.
    expect(sampleFromPointerEvent(event({ pointerType: 'stylus-eraser' }), origin).kind).toBe(
      PointerKind.Mouse,
    );
  });

  it('carries pressure for a pen and for nothing else', () => {
    // A mouse reports a constant 0.5, which no tool should act on: REQ-UX-068
    // makes pressure optional, and a tool that read the mouse's would apply a
    // pressure the user never varied.
    expect(
      sampleFromPointerEvent(event({ pointerType: 'pen', pressure: 0.7 }), origin).pressure,
    ).toBeCloseTo(0.7, 10);
    expect(
      sampleFromPointerEvent(event({ pointerType: 'mouse' }), origin).pressure,
    ).toBeUndefined();
    expect(
      sampleFromPointerEvent(event({ pointerType: 'touch' }), origin).pressure,
    ).toBeUndefined();
  });
});
