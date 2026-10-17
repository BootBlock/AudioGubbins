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
 * family. A value that moves either way from a resting point is centred: its
 * fill runs from a marked detent rather than from the minimum. The thumb
 * follows the pointer in the frame it moves, with no transition on where it
 * sits.
 */

import { Slider } from 'radix-ui';
import { useId, type CSSProperties, type ReactNode } from 'react';

import {
  type ControlDescription,
  DescriptionHint,
  DescriptionText,
} from './control-description.js';
import { ControlHint, describedBy } from './control-hint.js';
import {
  fractionOf,
  fractionOfValue,
  isLocked,
  placeHandlers,
  travelOf,
  type DialProps,
  type Travel,
} from './dials/value-travel.js';

/** What a slider takes besides a dial's fields. */
interface SliderFields {
  /**
   * The value of a centre detent, for a value that moves either way from a
   * resting point, such as a balance or a brightness: the fill runs from the
   * detent to the value, and the detent is marked. Left out, the fill runs
   * from the minimum.
   */
  readonly detent?: number;

  /**
   * A sentence saying what the value does: standing under the slider, or
   * behind an (i) beside its label.
   */
  readonly description?: ControlDescription;
}

/**
 * What the slider shows of its name: `label`, which is always its accessible
 * name, or a shorter word in its place, or nothing where what surrounds it
 * already says what it sets.
 */
type SliderLabelling =
  | {
      /**
       * The word drawn in place of the label, where a row of sliders has room
       * for one word each, such as "Mix" for "Mix of the reverb": the label
       * stays the name a screen reader says.
       */
      readonly visibleLabel?: string;
      readonly labelHidden?: false;
    }
  | {
      /** Keeps the label for a screen reader alone. */
      readonly labelHidden: true;
      readonly visibleLabel?: undefined;
    };

/** What a slider takes. */
export type ValueSliderProps = DialProps & SliderFields & SliderLabelling;

/** Where a centred fill runs along the groove, as fractions of it, for its stylesheet. */
type FillStyle = CSSProperties & {
  readonly '--ag-slider-from': string;
  readonly '--ag-slider-to': string;
};

/** Where the detent sits along the groove, as a fraction of it. */
type DetentStyle = CSSProperties & { readonly '--ag-slider-detent': string };

/** The fill along the groove: from the minimum, or from the detent either way to the value. */
function SliderFill({
  props,
  travel,
}: {
  readonly props: ValueSliderProps;
  readonly travel: Travel;
}): ReactNode {
  if (props.detent === undefined) return <Slider.Range className="ag-slider-range" />;
  const detent = fractionOfValue(props, props.detent);
  const at = fractionOf(travel, travel.at);
  const fill: FillStyle = {
    '--ag-slider-from': String(Math.min(detent, at)),
    '--ag-slider-to': String(Math.max(detent, at)),
  };
  const mark: DetentStyle = { '--ag-slider-detent': String(detent) };
  return (
    <>
      <span className="ag-slider-range" data-ag-centred="" style={fill} />
      <span className="ag-slider-detent" style={mark} />
    </>
  );
}

/**
 * The slider's name: the label, drawn, or said alone with a shorter word drawn
 * in its place, or said alone; and the (i) of a description behind one.
 */
function SliderHeading({
  props,
  labelId,
}: {
  readonly props: ValueSliderProps;
  readonly labelId: string;
}): ReactNode {
  const { label, visibleLabel, labelHidden = false, description } = props;
  const hint = <DescriptionHint description={description} />;
  if (labelHidden) {
    return (
      <>
        <span className="ag-visually-hidden" id={labelId}>
          {label}
        </span>
        {hint}
      </>
    );
  }
  return (
    <span className="ag-labelled ag-slider-label">
      {visibleLabel === undefined ? (
        <span id={labelId}>{label}</span>
      ) : (
        <>
          <span className="ag-visually-hidden" id={labelId}>
            {label}
          </span>
          <span aria-hidden="true">{visibleLabel}</span>
        </>
      )}
      {hint}
    </span>
  );
}

/** A control for a continuous value. */
export function ValueSlider(props: ValueSliderProps): ReactNode {
  const { value, describeValue, displayValue, unavailableReason, description } = props;
  const labelId = useId();
  const descriptionId = useId();
  const travel = travelOf(props);
  const unavailable = unavailableReason !== undefined;

  return (
    <div className="ag-slider-field" data-ag-locked={isLocked(props) ? '' : undefined}>
      <SliderHeading props={props} labelId={labelId} />
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
          <SliderFill props={props} travel={travel} />
        </Slider.Track>
        <ControlHint unavailableReason={unavailableReason}>
          {({ reasonId }) => (
            <Slider.Thumb
              className="ag-slider-thumb ag-touch-target"
              // The slider role sits on the thumb, not the root, so the label
              // and the spoken value belong here. On the root they would name
              // an element a screen reader never lands on.
              aria-labelledby={labelId}
              aria-valuetext={describeValue(value)}
              aria-disabled={unavailable ? true : undefined}
              {...describedBy(description === undefined ? undefined : descriptionId, reasonId)}
            />
          )}
        </ControlHint>
      </Slider.Root>
      {displayValue !== undefined && <span className="ag-slider-value">{displayValue}</span>}
      <DescriptionText
        description={description}
        id={descriptionId}
        className="ag-slider-description"
      />
    </div>
  );
}
