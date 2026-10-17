/**
 * A transport button: stop, a locate, the test signal, and the main button
 * that plays and pauses (design language, section 10, "Transport buttons").
 *
 * Round, so the transport reads as the machine's own controls rather than a
 * toolbar's. An ordinary one is a circle a little larger than a control on
 * the quiet fill; the main one is larger again and lit as a call to action,
 * its filled glyph at the feature size, and while what it runs is running it
 * grows once more and gains a ring and a glow. It is a `Button`, so it keeps
 * the button's hint, shortcut and unavailable reason, and a toolbar's roving
 * focus reaches it.
 */

import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { Icon, IconSize } from '../../icons/icon.js';
import type { IconName } from '../../icons/vocabulary.js';
import { Button, ButtonTone } from '../button.js';

/** An ordinary transport button. */
interface OrdinaryTransport {
  readonly main?: false;
  readonly running?: never;
}

/** The main transport button, which plays and pauses. */
interface MainTransport {
  /** The transport's main button: larger, lit as a call to action. */
  readonly main: true;

  /**
   * Whether what it runs is running, such as playback: the button grows and
   * its glow rings it. Its glyph and label, pause rather than play, are its
   * caller's.
   */
  readonly running?: boolean;
}

/** What a transport button takes. */
export type TransportButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'className' | 'children' | 'aria-pressed'
> & {
  /** The glyph, by the vocabulary's name. */
  readonly icon: IconName;

  /** The accessible name, which the glyph alone cannot give. */
  readonly label: string;

  /** The hint shown on hover or focus. */
  readonly hint?: string;

  /** The shortcut, shown after the hint (REQ-UX-066). */
  readonly shortcut?: string;

  /** Why the button cannot be used now, or `undefined` while it can (ADR-0013). */
  readonly unavailableReason?: string;
} & (OrdinaryTransport | MainTransport);

/** A round button of the transport. */
export const TransportButton = forwardRef<HTMLButtonElement, TransportButtonProps>(
  function TransportButton({ icon, label, main = false, running = false, ...rest }, ref) {
    return (
      <Button
        {...rest}
        ref={ref}
        tone={main ? ButtonTone.Primary : ButtonTone.Neutral}
        iconOnly
        label={label}
        data-ag-transport={main ? 'main' : 'ordinary'}
        data-ag-running={main && running ? '' : undefined}
      >
        <Icon name={icon} size={main ? IconSize.Feature : IconSize.Control} />
      </Button>
    );
  },
);
