/**
 * A control for a continuous value: a Radix slider, whose thumb carries the
 * label and the value in the unit the user is working in (REQ-UX-005,
 * REQ-UX-071), along a travel divided in even steps of the value or by a
 * scale the value does not move evenly with, such as a frequency's decades.
 *
 * It says the value under a drag as it moves, and, apart, the value the
 * person settled on, once a drag ends and at each keyboard step, so a value
 * that is kept can be made only from what was settled on.
 *
 * Drawn as the design language's slider (section 10): a recessed groove, a
 * glowing fill and a glossy thumb, with its value trailing in the numeric
 * family. The thumb follows the pointer in the frame it moves, with no
 * transition on where it sits.
 */

import { Slider } from 'radix-ui';
import { useId, type ReactNode } from 'react';

import { UnavailableReason } from './dials/unavailable-reason.js';
import { isLocked, placeHandlers, travelOf, type DialProps } from './dials/value-travel.js';

/** What a slider takes. */
export type ValueSliderProps = DialProps;

/** A control for a continuous value. */
export function ValueSlider(props: ValueSliderProps): ReactNode {
  const { label, value, describeValue, displayValue, unavailableReason } = props;
  const labelId = useId();
  const reasonId = useId();
  const travel = travelOf(props);
  const unavailable = unavailableReason !== undefined;

  return (
    <div className="ag-slider-field" data-ag-locked={isLocked(props) ? '' : undefined}>
      <span className="ag-slider-label" id={labelId}>
        {label}
      </span>
      <Slider.Root
        className="ag-slider"
        value={[travel.at]}
        min={travel.min}
        max={travel.max}
        step={travel.step}
        // An unavailable slider stays focusable, so its reason can be reached;
        // it is held still by refusing every change rather than by Radix's
        // disabled state, which takes the thumb out of the focus order.
        disabled={props.disabled ?? false}
        {...placeHandlers(props, travel)}
      >
        <Slider.Track className="ag-slider-track">
          <Slider.Range className="ag-slider-range" />
        </Slider.Track>
        <UnavailableReason id={reasonId} reason={unavailableReason}>
          <Slider.Thumb
            className="ag-slider-thumb ag-touch-target"
            // The slider role sits on the thumb, not the root, so the label and
            // the spoken value belong here. On the root they would name an
            // element a screen reader never lands on.
            aria-labelledby={labelId}
            aria-valuetext={describeValue(value)}
            aria-disabled={unavailable ? true : undefined}
            aria-describedby={unavailable ? reasonId : undefined}
          />
        </UnavailableReason>
      </Slider.Root>
      {displayValue !== undefined && <span className="ag-slider-value">{displayValue}</span>}
    </div>
  );
}
