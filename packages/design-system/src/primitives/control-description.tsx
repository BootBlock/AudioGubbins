/**
 * A control's description: a sentence standing under its label, or, where the
 * caller opts in, kept behind an (i) beside the label (design language,
 * section 13, text economy).
 *
 * Standing is the default, because a description a reader has to open is one
 * fewer reader sees. Behind an (i), the text is still the control's
 * description to a screen reader, present out of sight beside the control, so
 * focusing the control says it without the (i) being opened: text economy
 * removes words from the page, never from what a reader is told.
 */

import type { ReactNode } from 'react';

import { Hint } from './overlays/hint.js';

/** A description kept behind an (i) beside the control's label. */
export interface HintedDescription {
  /** The (i)'s accessible name, which says what it explains, such as "About monitoring". */
  readonly hintLabel: string;

  /** The description itself. */
  readonly text: string;
}

/** A control's description: a sentence standing under its label, or one behind an (i). */
export type ControlDescription = string | HintedDescription;

/** The (i) beside a label, where the description is kept behind one. */
export function DescriptionHint({
  description,
}: {
  readonly description: ControlDescription | undefined;
}): ReactNode {
  if (description === undefined || typeof description === 'string') return null;
  return (
    <Hint label={description.hintLabel}>
      <p>{description.text}</p>
    </Hint>
  );
}

/**
 * The text the control names as its description: standing, in the control's
 * own class, or, behind an (i), present for a screen reader alone.
 */
export function DescriptionText({
  description,
  id,
  className,
}: {
  readonly description: ControlDescription | undefined;
  readonly id: string;
  readonly className: string;
}): ReactNode {
  if (description === undefined) return null;
  return typeof description === 'string' ? (
    <span className={className} id={id}>
      {description}
    </span>
  ) : (
    <span className="ag-visually-hidden" id={id}>
      {description.text}
    </span>
  );
}
