/**
 * A progress bar: an operation under way (design language, section 9,
 * "Loading").
 *
 * A recessed track holding a fill of the call to action's gradient with a
 * sheen and an accent glow. Determinate, the fill grows to each new value;
 * indeterminate, a segment a little over a third of the track passes along
 * it. Radix supplies the progress bar's role and value.
 */

import { Progress } from 'radix-ui';
import type { CSSProperties, ReactNode } from 'react';

/** Where a bar sits, which sets its track's height. */
export const ProgressPlace = {
  /** In a panel: the track's ordinary height. */
  Panel: 'panel',

  /** Under a list row's name: a thinner track. */
  Row: 'row',

  /** In a dialogue: a taller track. */
  Dialogue: 'dialogue',
} as const;

/** Where a bar sits. */
export type ProgressPlace = (typeof ProgressPlace)[keyof typeof ProgressPlace];

/** What a progress bar takes. */
export interface ProgressBarProps {
  /** What is under way, for a screen reader. */
  readonly label: string;

  /**
   * How far it has come, from 0 to 1, or `null` while that is not known, which
   * draws the indeterminate segment.
   */
  readonly value: number | null;

  /** Says the value in words, such as "4.1 of 9.6 MB". A percentage otherwise. */
  readonly valueText?: (value: number) => string;

  readonly place?: ProgressPlace;
}

/** The fill's share of the track, read by the stylesheet. */
interface FillStyle extends CSSProperties {
  readonly '--ag-progress-value': string;
}

/** Where 0 and 1 are on Radix's scale, which counts to a hundred. */
const SCALE = 100;

/** A progress bar. */
export function ProgressBar({
  label,
  value,
  valueText,
  place = ProgressPlace.Panel,
}: ProgressBarProps): ReactNode {
  const known = value === null ? null : Math.min(1, Math.max(0, value));
  const fill: FillStyle | undefined =
    known === null ? undefined : { '--ag-progress-value': String(known) };

  return (
    <Progress.Root
      className="ag-progress"
      data-ag-place={place}
      aria-label={label}
      value={known === null ? null : known * SCALE}
      max={SCALE}
      {...(valueText === undefined
        ? {}
        : { getValueLabel: (current: number) => valueText(current / SCALE) })}
    >
      <Progress.Indicator className="ag-progress-fill" style={fill} />
    </Progress.Root>
  );
}
