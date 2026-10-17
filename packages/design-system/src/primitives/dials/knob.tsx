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

import { useId, type CSSProperties, type ReactNode } from 'react';

import { KnobFace } from './knob-face.js';
import { knobAngle } from './knob-geometry.js';
import { TypedValueField, type DialTyping } from './typed-value-field.js';
import { UnavailableReason } from './unavailable-reason.js';
import { useKnobTurn } from './use-knob-turn.js';
import { fractionOf, isLocked, travelOf, type DialProps } from './value-travel.js';

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
  const { dragging, handlers } = useKnobTurn(props, travel, locked);

  return (
    <div
      className="ag-knob"
      data-ag-bypassed={props.bypassed === true ? '' : undefined}
      data-ag-locked={locked ? '' : undefined}
    >
      <UnavailableReason id={reasonId} reason={unavailableReason}>
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
          {...handlers}
        >
          <KnobFace fraction={fraction} />
        </div>
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
