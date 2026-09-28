/**
 * The button.
 *
 * Every other control in AudioGubbins that a user presses is one of these or is
 * built from one, so the accessibility and the touch-target handling are solved
 * once. REQ-UX-005 makes keyboard and touch first-class, and a toolbar of bare
 * `<button>` elements would solve neither consistently.
 */

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

/** How prominent the button is. */
export const ButtonTone = {
  /** The action a dialogue or a form is primarily for. */
  Primary: 'primary',

  /** An ordinary action. */
  Neutral: 'neutral',

  /** An action with no surface of its own, for a toolbar or a menu bar. */
  Quiet: 'quiet',

  /** An action that removes or overwrites something. */
  Destructive: 'destructive',
} as const;

/** How prominent the button is. */
export type ButtonTone = (typeof ButtonTone)[keyof typeof ButtonTone];

/** What a button takes. */
export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  readonly tone?: ButtonTone;

  /** Uses the compact control height, for a toolbar. */
  readonly compact?: boolean;

  /**
   * Whether the button shows an icon and nothing else.
   *
   * An icon-only button must carry a name for a screen reader, so `label` stops
   * being optional when this is set. That is enforced by the type below rather
   * than by a lint rule, because the rule cannot know the button is icon-only.
   */
  readonly iconOnly?: boolean;

  /**
   * The accessible name.
   *
   * Required when the button has no visible text. Supplied alongside visible
   * text it becomes the name a screen reader announces, which is how a button
   * reading "Delete" can announce "Delete 3 regions".
   */
  readonly label?: string;

  readonly children?: ReactNode;
}

/** An icon-only button must name itself for a screen reader. */
type IconOnlyRequiresLabel =
  { readonly iconOnly?: false } | { readonly iconOnly: true; readonly label: string };

/** The button. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps & IconOnlyRequiresLabel>(
  function Button(
    { tone = ButtonTone.Neutral, compact = false, iconOnly = false, label, children, ...rest },
    ref,
  ) {
    return (
      <button
        {...rest}
        ref={ref}
        // An explicit type, because a button inside a form defaults to submit,
        // and a toolbar button that submits its surrounding form is a defect
        // that only appears once the form exists.
        type={rest.type ?? 'button'}
        // An icon-only button draws smaller than a finger, so its hit area is
        // widened to the touch target. A compact button sits in a bar beside
        // other regions, where a widened area would lie over the region below
        // and take its taps, so on a touch screen it is drawn at the touch
        // target instead. The menus along the top are compact buttons, and with
        // neither they would draw at the compact control height on a touch
        // screen.
        className={[
          'ag-button',
          iconOnly ? 'ag-touch-target' : '',
          compact && !iconOnly ? 'ag-touch-sized' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        data-ag-tone={tone}
        data-ag-compact={compact ? '' : undefined}
        data-ag-icon-only={iconOnly ? '' : undefined}
        aria-label={label}
      >
        {children}
      </button>
    );
  },
);
