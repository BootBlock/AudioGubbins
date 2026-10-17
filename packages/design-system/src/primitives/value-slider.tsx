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
}

/** What a slider takes. */
export type ValueSliderProps = DialProps & SliderFields;

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

/** A control for a continuous value. */
export function ValueSlider(props: ValueSliderProps): ReactNode {
  const { label, value, describeValue, displayValue, unavailableReason } = props;
  const labelId = useId();
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
              {...describedBy(reasonId)}
            />
          )}
        </ControlHint>
      </Slider.Root>
      {displayValue !== undefined && <span className="ag-slider-value">{displayValue}</span>}
    </div>
  );
}
