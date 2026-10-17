/**
 * A setting drawn as a heading over its control, the way the settings pages
 * set out a choice the control itself does not label in sight: a segmented
 * control or a row of swatches names its group for a screen reader alone.
 *
 * The heading is the group's name said in sight, so it is hidden from the
 * accessibility tree, where the control already carries that name; read twice,
 * every choice would be announced under its own name a second time. The value
 * beside it is the chosen choice's name, which the control says as well.
 */

import type { ReactNode } from 'react';

/** How the control under the heading is drawn. */
export const ChoiceLook = {
  /** As the control draws itself. */
  Plain: 'plain',

  /** Each choice a card showing what it makes, such as a theme or a density. */
  Previews: 'previews',

  /** Each choice a glass bead of its colour: the accents. */
  Swatches: 'swatches',
} as const;

/** How the control under the heading is drawn. */
export type ChoiceLook = (typeof ChoiceLook)[keyof typeof ChoiceLook];

/** What a choice field takes. */
export interface ChoiceFieldProps {
  /** The words in sight over the control, the start of the control's own name. */
  readonly heading: string;

  /** The chosen choice's name, at the heading's trailing end. */
  readonly value?: string;

  /** An (i) after the heading, which stays in the accessibility tree. */
  readonly hint?: ReactNode;

  readonly look?: ChoiceLook;

  readonly children: ReactNode;
}

/** A heading over a control that names itself for a screen reader alone. */
export function ChoiceField({
  heading,
  value,
  hint,
  look = ChoiceLook.Plain,
  children,
}: ChoiceFieldProps): ReactNode {
  return (
    <div className="ag-settings-choice" data-ag-look={look}>
      <div className="ag-settings-choice-heading">
        <span aria-hidden="true">{heading}</span>
        {hint}
        {value !== undefined && (
          <span className="ag-settings-choice-value" aria-hidden="true">
            {value}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
