/**
 * A spinner: a short wait inside a control, drawn at an icon's size as a ring
 * of the accent at a fifth with the accent on its top quarter (design
 * language, section 9, "Loading").
 *
 * It turns at the full motion level, at half speed at Reduced, where it moves
 * in place and never across the screen, and stands still at Minimal, where
 * the words beside it carry the state.
 */

import type { ReactNode } from 'react';

import { IconSize } from '../../icons/icon.js';

/** What a spinner takes. */
export interface SpinnerProps {
  /** Its size, an icon's: the control's by default. */
  readonly size?: IconSize;

  /**
   * What is being waited for, for a screen reader. Without it the spinner is
   * decoration, for words beside it that already say so.
   */
  readonly label?: string;
}

/** A spinner. */
export function Spinner({ size = IconSize.Control, label }: SpinnerProps): ReactNode {
  return (
    <span
      className="ag-spinner"
      data-ag-size={size}
      {...(label === undefined
        ? { 'aria-hidden': true }
        : { role: 'progressbar', 'aria-label': label, 'aria-busy': true })}
    />
  );
}
