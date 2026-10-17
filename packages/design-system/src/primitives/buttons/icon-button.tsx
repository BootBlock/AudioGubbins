/**
 * The icon button: a glyph and nothing else, named for a screen reader.
 *
 * It has no padding of its own (design language, section 10). The glyph is
 * drawn by `Icon`, which centres it by its ink, and the button places the
 * glyph's grid at its own centre, so the ink sits as far from every edge as
 * from the others with no optical shift applied by hand. Full size, it is a
 * panel header's action, a target as tall as the strip it sits in; compact, a
 * toolbar's.
 */

import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { Icon } from '../../icons/icon.js';
import type { IconName } from '../../icons/vocabulary.js';
import { Button, ButtonTone } from '../button.js';

/** What an icon button takes. */
export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'className' | 'children' | 'aria-pressed'
> {
  /** The glyph, by the vocabulary's name. */
  readonly icon: IconName;

  /** The accessible name, which the glyph alone cannot give. */
  readonly label: string;

  /** Quiet by default: an icon button has no surface until it is hovered or on. */
  readonly tone?: ButtonTone;

  /** Uses the small control height, for a toolbar. */
  readonly compact?: boolean;

  /**
   * Whether a mode the button toggles is on. Left out, the button runs an
   * action and has no on state.
   */
  readonly pressed?: boolean;

  /** The hint shown on hover or focus. */
  readonly hint?: string;

  /** The shortcut, shown after the hint (REQ-UX-066). */
  readonly shortcut?: string;

  /** Why the button cannot be used now, or `undefined` while it can (ADR-0013). */
  readonly unavailableReason?: string;
}

/** A button that shows one glyph. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, tone = ButtonTone.Quiet, pressed, ...rest },
  ref,
) {
  return (
    <Button
      {...rest}
      ref={ref}
      tone={tone}
      iconOnly
      label={label}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
    >
      <Icon name={icon} />
    </Button>
  );
});
