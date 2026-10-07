/**
 * A control for a continuous value: a Radix slider, whose thumb carries the
 * label and the value in the unit the user is working in (REQ-UX-005,
 * REQ-UX-071), along a travel divided in even steps of the value or by a
 * scale the value does not move evenly with, such as a frequency's decades.
 *
 * It says the value under a drag as it moves, and, apart, the value the
 * person settled on, once a drag ends and at each keyboard step, so a value
 * that is kept can be made only from what was settled on.
 */

import { Slider } from 'radix-ui';
import { useId, type ReactNode } from 'react';

/**
 * Where a value lies along a slider's travel, for a value that does not move
 * evenly with it: a frequency, say, whose every decade takes the same length
 * of travel.
 */
export interface SliderScale {
  /** The equal steps the travel is divided into, each a keyboard press. */
  readonly steps: number;

  /** Where `value` lies, from 0 at one end of the travel to 1 at the other. */
  readonly positionOf: (value: number) => number;

  /** The value at `position`, from 0 to 1 along the travel. */
  readonly valueAt: (position: number) => number;
}

/** How a slider's travel is divided: in even steps of the value, or by a scale. */
type SliderTravel =
  | {
      /** The smallest change a keyboard press or a drag produces. */
      readonly step: number;
      readonly scale?: undefined;
    }
  | { readonly scale: SliderScale; readonly step?: undefined };

/** What a slider takes, however its travel is divided. */
interface SliderFields {
  /** The visible label. */
  readonly label: string;

  readonly value: number;
  readonly minimum: number;
  readonly maximum: number;

  readonly onValueChange: (value: number) => void;

  /**
   * Runs with the value the person settled on: once a drag ends, and at each
   * keyboard step. Where only a settled value should be kept, a change is
   * made from this, and `onValueChange` only shows the value as it moves.
   */
  readonly onValueCommit?: (value: number) => void;

  /**
   * Turns the value into the words a screen reader should say.
   *
   * For example `(value) => `${value.toFixed(1)} decibels``. Without this a
   * screen reader announces a bare number, which for a logarithmic control is
   * not the number the user is thinking about.
   */
  readonly describeValue: (value: number) => string;

  /** Shown beside the control, for example `-6.0 dB`. */
  readonly displayValue?: string;

  readonly disabled?: boolean;
}

/** What a slider takes. */
export type ValueSliderProps = SliderFields & SliderTravel;

/** A slider's travel in the units Radix moves in, and the value a move there reports. */
interface Travel {
  readonly at: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** The value of the place Radix reports, or `undefined` where it reports none. */
  readonly valueOf: (places: readonly number[]) => number | undefined;
}

/**
 * The slider's travel: the value itself where it moves evenly, and otherwise
 * a count of the scale's steps.
 */
function travelOf(props: ValueSliderProps): Travel {
  const { scale } = props;
  if (scale === undefined) {
    return {
      at: props.value,
      min: props.minimum,
      max: props.maximum,
      step: props.step,
      valueOf: ([place]) => place,
    };
  }
  return {
    at: Math.min(scale.steps, Math.max(0, scale.positionOf(props.value) * scale.steps)),
    min: 0,
    max: scale.steps,
    step: 1,
    valueOf: ([place]) => (place === undefined ? undefined : scale.valueAt(place / scale.steps)),
  };
}

/** A control for a continuous value. */
export function ValueSlider(props: ValueSliderProps): ReactNode {
  const { label, value, onValueChange, onValueCommit, describeValue, displayValue } = props;
  const labelId = useId();
  const travel = travelOf(props);

  return (
    <div className="ag-slider-field">
      <span className="ag-slider-label" id={labelId}>
        {label}
      </span>
      <Slider.Root
        className="ag-slider"
        value={[travel.at]}
        min={travel.min}
        max={travel.max}
        step={travel.step}
        disabled={props.disabled ?? false}
        onValueChange={(places) => {
          const moved = travel.valueOf(places);
          if (moved !== undefined) onValueChange(moved);
        }}
        onValueCommit={(places) => {
          const settled = travel.valueOf(places);
          if (settled !== undefined) onValueCommit?.(settled);
        }}
      >
        <Slider.Track className="ag-slider-track">
          <Slider.Range className="ag-slider-range" />
        </Slider.Track>
        <Slider.Thumb
          className="ag-slider-thumb ag-touch-target"
          // The slider role sits on the thumb, not the root, so the label and
          // the spoken value belong here. On the root they would name an
          // element a screen reader never lands on.
          aria-labelledby={labelId}
          aria-valuetext={describeValue(value)}
        />
      </Slider.Root>
      {displayValue !== undefined && <span className="ag-slider-value">{displayValue}</span>}
    </div>
  );
}
