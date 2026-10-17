/**
 * How a dial's travel maps to the value it sets: the slider's, the knob's and
 * the fader's alike, so a parameter's taper is given once by the panel that
 * owns it and every control that shows the parameter moves along it the same
 * way (REQ-UX-005, REQ-UX-071).
 *
 * The travel is counted in places: the value itself where it moves evenly, and
 * otherwise a count of the scale's equal steps, each a keyboard press.
 */

/**
 * Where a value lies along a control's travel, for a value that does not move
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

/** How a control's travel is divided: in even steps of the value, or by a scale. */
export type ValueTravel =
  | {
      /** The smallest change a keyboard press or a drag produces. */
      readonly step: number;
      readonly scale?: undefined;
    }
  | { readonly scale: SliderScale; readonly step?: undefined };

/** What every dial takes, however its travel is divided. */
export interface DialFields {
  /** The control's name, shown or spoken. */
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

  /**
   * Why the control cannot be used now (ADR-0013). Given, the control is
   * unavailable: it keeps its focus, so the reason is reached by a keyboard as
   * by a pointer, and it changes nothing.
   */
  readonly unavailableReason?: string;
}

/** What a dial takes. */
export type DialProps = DialFields & ValueTravel;

/** A control's travel in places, and the value a place stands for. */
export interface Travel {
  /** The place the value is at. */
  readonly at: number;
  readonly min: number;
  readonly max: number;

  /** The smallest move of a keyboard press, in places. */
  readonly step: number;

  /** The value at `place`. */
  readonly valueAt: (place: number) => number;
}

/**
 * The control's travel: the value itself where it moves evenly, and otherwise
 * a count of the scale's steps.
 */
export function travelOf(props: DialProps): Travel {
  const { scale } = props;
  if (scale === undefined) {
    return {
      at: props.value,
      min: props.minimum,
      max: props.maximum,
      step: props.step,
      valueAt: (place) => place,
    };
  }
  return {
    at: Math.min(scale.steps, Math.max(0, scale.positionOf(props.value) * scale.steps)),
    min: 0,
    max: scale.steps,
    step: 1,
    valueAt: (place) => scale.valueAt(place / scale.steps),
  };
}

/** Where a place lies along the travel, from 0 at its start to 1 at its end. */
export function fractionOf(travel: Travel, place: number): number {
  const span = travel.max - travel.min;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (place - travel.min) / span));
}

/** Where a value other than the control's own lies along its travel, from 0 to 1: a printed mark's. */
export function fractionOfValue(props: DialProps, value: number): number {
  const travel = travelOf({ ...props, value });
  return fractionOf(travel, travel.at);
}

/** The place nearest `place` that is a whole number of steps from the start, within the travel. */
export function snappedPlace(travel: Travel, place: number): number {
  const steps = Math.round((place - travel.min) / travel.step);
  return Math.min(travel.max, Math.max(travel.min, travel.min + steps * travel.step));
}

/** Whether the person cannot change the control now: it is disabled, or unavailable for a reason. */
export function isLocked(props: DialFields): boolean {
  return (props.disabled ?? false) || props.unavailableReason !== undefined;
}

/** What a Radix slider calls as it moves and as it settles, with the places it reports. */
export interface PlaceHandlers {
  readonly onValueChange: (places: number[]) => void;
  readonly onValueCommit: (places: number[]) => void;
}

/**
 * A Radix slider's callbacks for a dial: each place it reports turned into
 * the value it stands for, and every change refused while the dial is
 * unavailable, which holds it still while it keeps its focus.
 */
export function placeHandlers(props: DialProps, travel: Travel): PlaceHandlers {
  const report = (places: readonly number[], to: ((value: number) => void) | undefined): void => {
    const [place] = places;
    if (place === undefined || props.unavailableReason !== undefined) return;
    to?.(travel.valueAt(place));
  };
  return {
    onValueChange: (places) => {
      report(places, props.onValueChange);
    },
    onValueCommit: (places) => {
      report(places, props.onValueCommit);
    },
  };
}
