/**
 * A fader (design language, section 10), after a console's long-throw fader:
 * a dark slot, a scale printed down both sides with one mark emphasised, a
 * tall ridged cap with a lit index line, and the slot lit from the cap down,
 * on a grid 64 units wide with its slot at 40.
 *
 * A Radix slider standing on end (ADR-0009), so its keys, its pointer and
 * what it tells a screen reader are the slider's: an arrow a step, a Page key
 * ten, Home and End to the ends. The cap follows the pointer in the frame it
 * moves, with no transition on where it sits.
 *
 * It takes its value, its taper and its printed marks as plain values from
 * its caller and knows no domain: the caller says which mark is the one to
 * emphasise, a gain fader's unity, and which marks a short fader leaves out.
 */

import { Slider } from 'radix-ui';
import { useId, useLayoutEffect, useState, type CSSProperties, type ReactNode } from 'react';

import { useTheme } from '../../theme/theme-provider.js';
import { UnavailableReason } from './unavailable-reason.js';
import {
  fractionOf,
  fractionOfValue,
  isLocked,
  placeHandlers,
  travelOf,
  type DialProps,
  type Travel,
} from './value-travel.js';

/** A mark printed down both sides of a fader's slot. */
export interface FaderMark {
  /** The value it marks. */
  readonly value: number;

  /** How it is printed, for example `−10`. */
  readonly label: string;

  /** The one mark that stands out, in a heavier line and weight: a gain fader's unity. */
  readonly emphasised?: boolean;

  /** A mark a short fader leaves out, so the marks it keeps have room to read. */
  readonly minor?: boolean;
}

/** What a fader takes besides a dial's fields. */
interface FaderFields {
  /** The marks printed down both sides of its slot, in order. */
  readonly marks?: readonly FaderMark[];

  /**
   * Whether what the fader sets is switched off, a bypassed processor's: its
   * slot and index line go unlit, and it can still be moved.
   */
  readonly bypassed?: boolean;
}

/** What a fader takes. */
export type FaderProps = DialProps & FaderFields;

/**
 * The cap's height and the shortest travel that prints every mark, in units
 * of the fader's grid: on a shorter one the minor marks are left out.
 */
const CAP_UNITS = 30;
const FULL_SCALE_TRAVEL = 150;

/** Where a fraction of the travel stands, for the stylesheet to place the slot's light and a mark. */
function atStyle(fraction: number): CSSProperties & { readonly '--ag-fader-at': string } {
  return { '--ag-fader-at': String(fraction) };
}

/**
 * Whether the fader's travel is too short for every mark, measured as it is
 * laid out: its height is its container's, which no stylesheet rule can ask.
 */
function useShortTravel(): readonly [(element: HTMLDivElement | null) => void, boolean] {
  const unit = useTheme().metrics.grid.unit / 2;
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [short, setShort] = useState(false);
  useLayoutEffect(() => {
    if (element === null) return undefined;
    const measure = (): void => {
      const travel = element.getBoundingClientRect().height / unit - CAP_UNITS;
      setShort(travel > 0 && travel < FULL_SCALE_TRAVEL);
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(element);
    return () => {
      watch.disconnect();
    };
  }, [element, unit]);
  return [setElement, short];
}

/** What a fader's slider is handed by the fader round it. */
interface FaderSliderProps {
  readonly dial: FaderProps;
  readonly travel: Travel;

  /** The fader's label, which names the cap. */
  readonly labelId: string;

  /** The reason it is unavailable, which describes the cap. */
  readonly reasonId: string;
}

/** The slot and its cap: the slider that moves the fader's value. */
function FaderSlider({ dial, travel, labelId, reasonId }: FaderSliderProps): ReactNode {
  const { value, describeValue, unavailableReason } = dial;
  const unavailable = unavailableReason !== undefined;
  return (
    <Slider.Root
      className="ag-fader-slider"
      orientation="vertical"
      value={[travel.at]}
      min={travel.min}
      max={travel.max}
      step={travel.step}
      // As the slider's: unavailable, it keeps its focus and refuses every
      // change, rather than leaving the focus order as disabled does.
      disabled={dial.disabled ?? false}
      {...placeHandlers(dial, travel)}
    >
      <Slider.Track className="ag-fader-slot">
        <span className="ag-fader-slot-level" />
      </Slider.Track>
      <UnavailableReason id={reasonId} reason={unavailableReason}>
        <Slider.Thumb
          className="ag-fader-cap ag-touch-target"
          aria-labelledby={labelId}
          aria-valuetext={describeValue(value)}
          aria-disabled={unavailable ? true : undefined}
          aria-describedby={unavailable ? reasonId : undefined}
        >
          <span className="ag-fader-index" />
        </Slider.Thumb>
      </UnavailableReason>
    </Slider.Root>
  );
}

/** A fader. */
export function Fader(props: FaderProps): ReactNode {
  const { label, displayValue, marks = [] } = props;
  const labelId = useId();
  const reasonId = useId();
  const travel = travelOf(props);
  const [measured, short] = useShortTravel();

  return (
    <div
      className="ag-fader"
      data-ag-bypassed={props.bypassed === true ? '' : undefined}
      data-ag-locked={isLocked(props) ? '' : undefined}
    >
      <span className="ag-visually-hidden" id={labelId}>
        {label}
      </span>
      <div
        ref={measured}
        className="ag-fader-body"
        data-ag-short={short ? '' : undefined}
        style={atStyle(fractionOf(travel, travel.at))}
      >
        <div className="ag-fader-scale" aria-hidden="true">
          {marks.map((mark) => (
            <span
              key={mark.label}
              className="ag-fader-mark"
              data-ag-emphasised={mark.emphasised === true ? '' : undefined}
              data-ag-minor={mark.minor === true ? '' : undefined}
              style={atStyle(fractionOfValue(props, mark.value))}
            >
              <span className="ag-fader-mark-label">{mark.label}</span>
            </span>
          ))}
        </div>
        <FaderSlider dial={props} travel={travel} labelId={labelId} reasonId={reasonId} />
      </div>
      {displayValue !== undefined && <span className="ag-fader-value">{displayValue}</span>}
    </div>
  );
}
