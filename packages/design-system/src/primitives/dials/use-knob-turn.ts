/**
 * How a person turns a knob: the keys move it as they move a slider, and a
 * drag up or to the right raises it, following the pointer in the frame it
 * moves. Both report a value only where it changed, and both commit as the
 * slider does: at each key, and once a drag ends.
 */

import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

import { placeAfterKey } from './dial-keys.js';
import { snappedPlace, type DialProps, type Travel } from './value-travel.js';

/**
 * How far a drag moves a knob from one end of its travel to the other, in
 * multiples of the knob's own size, so a knob turns as far under the same
 * movement at either density.
 */
const DRAG_REACH = 4;

/** A drag under way: where it started, on the screen and along the travel. */
interface Drag {
  readonly pointer: number;
  readonly startY: number;
  readonly startX: number;
  readonly startPlace: number;
  /** The pixels of movement the whole travel takes. */
  readonly reach: number;
  /** The last value the drag reported, which it commits when it ends. */
  last: number;
}

/** The handlers a drag takes on a knob's dial, and whether one is under way. */
interface KnobDrag {
  readonly dragging: boolean;
  readonly handlers: {
    readonly onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
    readonly onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
    readonly onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
    readonly onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
  };
}

/** What a knob's dial takes to be turned: the drag's handlers and the keys'. */
interface KnobTurn extends KnobDrag {
  readonly handlers: KnobDrag['handlers'] & {
    readonly onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  };
}

/** The value a key or a drag moved to, told to the caller only where it changed. */
function moveTo(props: DialProps, travel: Travel, place: number): number | undefined {
  if (place === travel.at) return undefined;
  const value = travel.valueAt(place);
  props.onValueChange(value);
  return value;
}

/** The key handler that steps a knob, which a locked knob takes and refuses. */
function keyTurn(
  props: DialProps,
  travel: Travel,
  locked: boolean,
): (event: KeyboardEvent<HTMLDivElement>) => void {
  return (event) => {
    const place = placeAfterKey(travel, event);
    if (place === undefined) return;
    event.preventDefault();
    if (locked) return;
    const moved = moveTo(props, travel, place);
    if (moved !== undefined) props.onValueCommit?.(moved);
  };
}

/** The drag that turns a knob, from a press of the main button to its release. */
function useDrag(props: DialProps, travel: Travel, locked: boolean): KnobDrag {
  const drag = useRef<Drag | undefined>(undefined);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (locked || event.button !== 0) return;
    const dial = event.currentTarget;
    dial.setPointerCapture(event.pointerId);
    dial.focus({ preventScroll: true });
    // Kept from selecting the text round the knob as the pointer moves.
    event.preventDefault();
    drag.current = {
      pointer: event.pointerId,
      startY: event.clientY,
      startX: event.clientX,
      startPlace: travel.at,
      reach: dial.getBoundingClientRect().height * DRAG_REACH,
      last: props.value,
    };
    setDragging(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const held = drag.current;
    if (held?.pointer !== event.pointerId || held.reach <= 0) return;
    // Up and to the right raise it, as on a hardware knob seen from the front.
    const moved = held.startY - event.clientY + (event.clientX - held.startX);
    const span = travel.max - travel.min;
    const place = snappedPlace(travel, held.startPlace + (moved / held.reach) * span);
    const reported = moveTo(props, travel, place);
    if (reported !== undefined) held.last = reported;
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>): void => {
    const held = drag.current;
    if (held?.pointer !== event.pointerId) return;
    drag.current = undefined;
    setDragging(false);
    if (event.type === 'pointerup') props.onValueCommit?.(held.last);
  };

  return {
    dragging,
    handlers: { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag },
  };
}

/** The keys and the drag that turn a knob, which a locked knob refuses. */
export function useKnobTurn(props: DialProps, travel: Travel, locked: boolean): KnobTurn {
  const { dragging, handlers } = useDrag(props, travel, locked);
  return { dragging, handlers: { ...handlers, onKeyDown: keyTurn(props, travel, locked) } };
}
