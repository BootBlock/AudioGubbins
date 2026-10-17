/**
 * A knob (design language, section 10): a printed tick scale on the panel, a
 * glowing value ring, a dark skirt with its own pointer, a fluted grip and a
 * brushed-metal cap whose index line turns, with its label and its value as a
 * field below it.
 *
 * The light falls from one place on the page, so the skirt, the grip and the
 * cap, and their shadows and highlights, never turn: only what is printed or
 * moulded on them does, the skirt's pointer, the grip's ribs and the cap's
 * index line.
 *
 * It takes its value and its taper as plain values from its caller and knows
 * no domain. A drag up or to the right raises it and follows the pointer in
 * the frame it moves, with no transition on the turn; the keys move it as they
 * move a slider.
 */

import {
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';

import { placeAfterKey } from './dial-keys.js';
import {
  KNOB_GRID,
  KNOB_RING_STROKE,
  KNOB_TICK_STROKE,
  KNOB_TICKS,
  KNOB_TRACK,
  knobAngle,
  knobValueArc,
} from './knob-geometry.js';
import { TypedValueField, type DialTyping } from './typed-value-field.js';
import { UnavailableReason } from './unavailable-reason.js';
import {
  fractionOf,
  isLocked,
  snappedPlace,
  travelOf,
  type DialProps,
  type Travel,
} from './value-travel.js';

/**
 * How far a drag moves a knob from one end of its travel to the other, in
 * multiples of the knob's own size, so a knob turns as far under the same
 * movement at either density.
 */
const DRAG_REACH = 4;

/** What a knob takes besides a dial's fields. */
interface KnobFields {
  /**
   * Whether what the knob sets is switched off, a bypassed processor's: its
   * value ring and index line go unlit, and it can still be turned.
   */
  readonly bypassed?: boolean;

  /** Makes the value a field a number can be typed into. Without it the value only reads. */
  readonly typing?: DialTyping;
}

/** What a knob takes. */
export type KnobProps = DialProps & KnobFields;

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

/** The value a key or a drag moved to, told to the caller only where it changed. */
function moveTo(props: KnobProps, travel: Travel, place: number): number | undefined {
  if (place === travel.at) return undefined;
  const value = travel.valueAt(place);
  props.onValueChange(value);
  return value;
}

/** The turn of everything printed or moulded on the knob, for its stylesheet to read. */
function turnStyle(fraction: number): CSSProperties & { readonly '--ag-knob-turn': string } {
  return { '--ag-knob-turn': `${String(knobAngle(fraction))}deg` };
}

/** A knob. */
export function Knob(props: KnobProps): ReactNode {
  const { label, value, describeValue, displayValue, typing, unavailableReason } = props;
  const labelId = useId();
  const reasonId = useId();
  const travel = travelOf(props);
  const locked = isLocked(props);
  const unavailable = unavailableReason !== undefined;
  const fraction = fractionOf(travel, travel.at);
  const valueArc = knobValueArc(fraction);
  const drag = useRef<Drag | undefined>(undefined);
  const [dragging, setDragging] = useState(false);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const place = placeAfterKey(travel, event);
    if (place === undefined) return;
    event.preventDefault();
    if (locked) return;
    const moved = moveTo(props, travel, place);
    if (moved !== undefined) props.onValueCommit?.(moved);
  };

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
      last: value,
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

  const dial = (
    <div
      className="ag-knob-dial ag-touch-target"
      role="slider"
      tabIndex={props.disabled === true ? undefined : 0}
      aria-labelledby={labelId}
      aria-valuemin={travel.min}
      aria-valuemax={travel.max}
      aria-valuenow={travel.at}
      aria-valuetext={describeValue(value)}
      aria-disabled={locked ? true : undefined}
      aria-describedby={unavailable ? reasonId : undefined}
      data-ag-dragging={dragging ? '' : undefined}
      style={turnStyle(fraction)}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <svg
        className="ag-knob-scale"
        viewBox={`0 0 ${String(KNOB_GRID)} ${String(KNOB_GRID)}`}
        strokeLinecap="round"
        fill="none"
      >
        {KNOB_TICKS.map((tick) => (
          <line
            key={`${String(tick.x1)},${String(tick.y1)}`}
            className={tick.major ? 'ag-knob-tick' : 'ag-knob-tick ag-knob-tick-minor'}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
            strokeWidth={KNOB_TICK_STROKE}
          />
        ))}
        <path className="ag-knob-track" d={KNOB_TRACK} strokeWidth={KNOB_RING_STROKE} />
        {valueArc !== undefined && (
          <path className="ag-knob-value-ring" d={valueArc} strokeWidth={KNOB_RING_STROKE} />
        )}
      </svg>
      <span className="ag-knob-skirt">
        <span className="ag-knob-turned">
          <span className="ag-knob-pointer" />
        </span>
      </span>
      <span className="ag-knob-grip">
        <span className="ag-knob-turned ag-knob-ribs" />
      </span>
      <span className="ag-knob-cap">
        <span className="ag-knob-turned ag-knob-index" />
      </span>
    </div>
  );

  return (
    <div
      className="ag-knob"
      data-ag-bypassed={props.bypassed === true ? '' : undefined}
      data-ag-locked={locked ? '' : undefined}
    >
      <UnavailableReason id={reasonId} reason={unavailableReason}>
        {dial}
      </UnavailableReason>
      <span className="ag-knob-label" id={labelId}>
        {label}
      </span>
      {displayValue !== undefined &&
        (typing === undefined ? (
          <span className="ag-knob-value">{displayValue}</span>
        ) : (
          <TypedValueField display={displayValue} typing={typing} locked={locked} />
        ))}
    </div>
  );
}
