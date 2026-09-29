/**
 * One abstraction over mouse, touch and pen.
 *
 * REQ-UX-005 requires mouse, keyboard, touch and pen to be first-class.
 * REQ-UX-067 sets the gesture model inside an editing canvas: one finger is the
 * tool, two fingers pan, a pinch zooms, a pen is precision input and a long
 * press is the context action. REQ-UX-068 makes pen pressure optional in every
 * case, with a deterministic fixed strength always available.
 *
 * REQ-EXEC-216 names "touch input implies no keyboard or mouse" as an
 * assumption that must not be made. Nothing here switches an input off because
 * another was used: a Surface user alternates between pen, finger and trackpad
 * within one edit, and an application that picks a mode for them is wrong half
 * the time.
 *
 * The translation from pointer events to these values is a pure function of the
 * events, so the gesture rules are testable without a touchscreen.
 */

/** What is touching the screen. */
export const PointerKind = {
  Mouse: 'mouse',
  Touch: 'touch',
  Pen: 'pen',
} as const;

/** What is touching the screen. */
export type PointerKind = (typeof PointerKind)[keyof typeof PointerKind];

/** One point of contact. */
export interface PointerSample {
  /** Identifies this contact for as long as it lasts. */
  readonly pointerId: number;

  readonly kind: PointerKind;

  /** Position in the target's own coordinates. */
  readonly x: number;
  readonly y: number;

  /**
   * Pen pressure from 0 to 1, or `undefined` where the device reports none.
   *
   * Distinct from 0: a pen lifted off the surface reports 0, while a mouse
   * reports nothing at all. A tool that treats "no pressure reported" as "no
   * pressure applied" draws nothing for a mouse user (REQ-UX-068).
   */
  readonly pressure?: number;

  /** Milliseconds since the time origin, for gesture timing. */
  readonly timestamp: number;
}

/** What the user is doing. */
export type Gesture =
  | { readonly kind: 'idle' }
  | { readonly kind: 'tool'; readonly at: PointerSample }
  | { readonly kind: 'pan'; readonly dx: number; readonly dy: number }
  | {
      readonly kind: 'zoom';
      readonly scale: number;
      readonly centreX: number;
      readonly centreY: number;
    }
  | { readonly kind: 'context'; readonly at: PointerSample };

/** Nothing is happening. */
export const NO_GESTURE: Gesture = { kind: 'idle' };

/**
 * How gestures are recognised.
 *
 * A value with a default, and nothing persists it yet: no tool in this phase
 * has a strength that pressure could vary, so there is nothing for a user to
 * choose between. ADR-0017 gives the choice, which REQ-UX-068 requires, to the
 * phase that adds the first pressure-sensitive tool.
 */
export interface GestureSettings {
  /**
   * How long a contact must be still before it becomes a context action.
   *
   * REQ-UX-067 makes long press the touch equivalent of a right click. Five
   * hundred milliseconds is long enough not to fire while a user is starting a
   * drag, and short enough not to feel broken.
   */
  readonly longPressMs: number;

  /** How far a contact may move and still count as a long press. */
  readonly longPressTolerancePx: number;

  /**
   * Whether pen pressure varies the tool.
   *
   * REQ-UX-068 requires a deterministic fixed strength to remain available on
   * pressure-capable hardware, so this is a preference and not a capability.
   */
  readonly usePenPressure: boolean;

  /** The strength used when pressure is off or unreported, from 0 to 1. */
  readonly fixedStrength: number;
}

/** How gestures are recognised before a user changes anything. */
export const DEFAULT_GESTURE_SETTINGS: GestureSettings = {
  longPressMs: 500,
  longPressTolerancePx: 8,
  usePenPressure: true,
  fixedStrength: 0.75,
};

/**
 * How hard a tool should act for this contact.
 *
 * The one place the pressure rule lives (REQ-EXEC-136.11). Every pressure-using
 * tool asks this rather than reading `pressure` itself, so a user who has
 * turned pressure off gets the same fixed strength from all of them.
 */
export function toolStrength(sample: PointerSample, settings: GestureSettings): number {
  if (!settings.usePenPressure) return settings.fixedStrength;
  if (sample.kind !== PointerKind.Pen) return settings.fixedStrength;
  if (sample.pressure === undefined) return settings.fixedStrength;

  // Some pens report a constant 0.5 rather than admitting they cannot measure.
  // That is indistinguishable from a real steady press, so it is taken at face
  // value; the user who finds it unresponsive turns pressure off.
  return sample.pressure;
}

/** The distance between two contacts. */
function separation(first: PointerSample, second: PointerSample): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

/** The midpoint between two contacts. */
function midpoint(
  first: PointerSample,
  second: PointerSample,
): { readonly x: number; readonly y: number } {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

/**
 * Decides what the current contacts mean.
 *
 * Takes where the contacts started and where they are now, so the decision is a
 * function of its arguments and nothing else. A recogniser holding its own
 * mutable state would need a touchscreen to test and would give different
 * answers depending on what happened before.
 *
 * REQ-UX-067 sets the rules: one finger is the tool, two fingers pan and pinch
 * together, and a pen is always the tool however many fingers are also down,
 * because a hand resting on the screen must not turn drawing into panning. The
 * contact that is the tool, the pen or the one finger, held still for long
 * enough is the context action, as a pen held still on a tablet is its right
 * click; it is read against where that same contact started.
 */
export function recogniseGesture(
  started: readonly PointerSample[],
  current: readonly PointerSample[],
  settings: GestureSettings = DEFAULT_GESTURE_SETTINGS,
): Gesture {
  if (current.length === 0) return NO_GESTURE;

  const [firstNow, secondNow] = current;
  if (firstNow === undefined) return NO_GESTURE;

  const pen = current.find((sample) => sample.kind === PointerKind.Pen);
  const tool = pen ?? (current.length === 1 ? firstNow : undefined);
  if (tool !== undefined) {
    const start = started.find((sample) => sample.pointerId === tool.pointerId);
    if (start === undefined) return { kind: 'tool', at: tool };

    const held = tool.timestamp - start.timestamp;
    const moved = separation(start, tool);

    if (held >= settings.longPressMs && moved <= settings.longPressTolerancePx) {
      return { kind: 'context', at: tool };
    }

    return { kind: 'tool', at: tool };
  }

  // Two or more contacts: pan and zoom together, as a pinch always moves as
  // well as scales. Reporting only one of them would make a pinch feel as
  // though it drifts away from the fingers doing it.
  const [firstStart, secondStart] = started;
  if (secondNow === undefined || firstStart === undefined || secondStart === undefined) {
    return NO_GESTURE;
  }

  const startedApart = separation(firstStart, secondStart);
  const nowApart = separation(firstNow, secondNow);
  const centre = midpoint(firstNow, secondNow);

  if (startedApart > 0) {
    const scale = nowApart / startedApart;

    // A pinch that has not changed size is a two-finger pan. The threshold is
    // deliberately small: fingers never hold an exact distance, and treating
    // every wobble as a zoom would make panning jitter.
    if (Math.abs(scale - 1) > 0.02) {
      return { kind: 'zoom', scale, centreX: centre.x, centreY: centre.y };
    }
  }

  const startCentre = midpoint(firstStart, secondStart);
  return { kind: 'pan', dx: centre.x - startCentre.x, dy: centre.y - startCentre.y };
}

/**
 * The fields of a pointer event a sample is read from.
 *
 * Read structurally, so this package needs nothing of the browser's type
 * definitions and a browser `PointerEvent` is one without conversion.
 */
export interface PointerReading {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly clientX: number;
  readonly clientY: number;
  readonly pressure: number;
  readonly timeStamp: number;
}

/**
 * Turns a pointer event into a sample, in the coordinates of the element whose
 * top-left corner is at `origin`.
 *
 * The one place an event becomes an AudioGubbins value. `pressure` is dropped
 * for anything but a pen, because the specification only gives it meaning there
 * and a mouse reports a constant 0.5 that no tool should act on.
 */
export function sampleFromPointerEvent(
  event: PointerReading,
  origin: { readonly left: number; readonly top: number },
): PointerSample {
  const kind =
    event.pointerType === 'pen'
      ? PointerKind.Pen
      : event.pointerType === 'touch'
        ? PointerKind.Touch
        : PointerKind.Mouse;

  return {
    pointerId: event.pointerId,
    kind,
    x: event.clientX - origin.left,
    y: event.clientY - origin.top,
    ...(kind === PointerKind.Pen ? { pressure: event.pressure } : {}),
    timestamp: event.timeStamp,
  };
}
