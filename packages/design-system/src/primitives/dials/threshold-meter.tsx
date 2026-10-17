/**
 * A reading against its thresholds: a short bar in pass, warn and fail zones,
 * the reading a bright tick across it (design language, section 10, "A check
 * against thresholds"), as Loop draws each check beside its verdict.
 *
 * Its caller places the reading and the two thresholds along the bar, from 0
 * at its start to 1 at its end, on whatever scale the check is read in, so a
 * reading in decibels and one in deviations draw alike. A lower reading is the
 * better one, as every check that has thresholds reads. The bar is a meter to
 * a screen reader, its value said in the caller's words with the thresholds
 * it is held to, since the zones are colour alone.
 */

import type { CSSProperties, ReactNode } from 'react';

/** What a threshold meter takes. */
export interface ThresholdMeterProps {
  /** Its accessible name, such as "Click at the seam". */
  readonly label: string;

  /** Where the reading sits along the bar, from 0 to 1. */
  readonly value: number;

  /** Where the pass zone ends and the warn zone starts, from 0 to 1. */
  readonly passUntil: number;

  /**
   * Where the warn zone ends and the fail zone starts, from 0 to 1: 1 for a
   * check that warns but never fails.
   */
  readonly warnUntil: number;

  /**
   * The reading and what it is held to, in words, such as "11.4 deviations;
   * passes at 4 or less, warns to 8".
   */
  readonly valueText: string;
}

/** The places along the bar, read by the stylesheet. */
interface ZoneStyle extends CSSProperties {
  readonly '--ag-threshold-pass': string;
  readonly '--ag-threshold-warn': string;
  readonly '--ag-threshold-value': string;
}

/** A place held to the bar's two ends. */
function held(place: number): number {
  return Math.min(1, Math.max(0, place));
}

/** A reading against its thresholds. */
export function ThresholdMeter({
  label,
  value,
  passUntil,
  warnUntil,
  valueText,
}: ThresholdMeterProps): ReactNode {
  const at = held(value);
  const pass = held(passUntil);
  const style: ZoneStyle = {
    '--ag-threshold-pass': String(pass),
    // A warn zone that ended before the pass zone would draw the fail zone
    // over the pass zone's end.
    '--ag-threshold-warn': String(Math.max(pass, held(warnUntil))),
    '--ag-threshold-value': String(at),
  };
  return (
    <span
      className="ag-threshold-meter"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={at}
      aria-valuetext={valueText}
      style={style}
    >
      <span className="ag-threshold-meter-tick" />
    </span>
  );
}
