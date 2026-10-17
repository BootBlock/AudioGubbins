/**
 * Tooltips: the short hint a control shows on hover or focus, with its
 * shortcut in key caps.
 *
 * A tooltip names and explains; it never holds a control, and a reason an
 * action is unavailable is a popover the reader can reach, not only a hover.
 */

import { Tooltip as RadixTooltip } from 'radix-ui';
import type { ReactNode } from 'react';

import { ShortcutKeys } from './shortcut-keys.js';

/**
 * The floating part of a hint, for a control that composes its own trigger.
 *
 * A toolbar item's roving focus and the tooltip's trigger have to merge onto
 * one button, so the trigger cannot wrap a finished component: such a control
 * composes `Tooltip.Trigger` itself and draws this. `detail` is a second line
 * under the name, which makes it the rich variant.
 */
export function hintSurface(text: string, shortcut?: string, detail?: string): ReactNode {
  return (
    <RadixTooltip.Portal>
      <RadixTooltip.Content
        className="ag-tooltip ag-overlay"
        sideOffset={6}
        {...(detail === undefined ? {} : { 'data-ag-rich': '' })}
      >
        {detail === undefined ? (
          <span className="ag-tooltip-name">{text}</span>
        ) : (
          <span className="ag-tooltip-text">
            <span className="ag-tooltip-name">{text}</span>
            <span className="ag-tooltip-detail">{detail}</span>
          </span>
        )}
        {shortcut !== undefined && (
          <ShortcutKeys shortcut={shortcut} className="ag-tooltip-shortcut" />
        )}
        <RadixTooltip.Arrow className="ag-tooltip-arrow" />
      </RadixTooltip.Content>
    </RadixTooltip.Portal>
  );
}

/** What a tooltip takes. */
export interface TooltipProps {
  /** What the control is, in a word or two. */
  readonly label: string;

  /** What it does, as a second line under the name. */
  readonly detail?: string;

  /** The shortcut, already written for the platform (REQ-UX-066). */
  readonly shortcut?: string;

  /**
   * The control the tooltip belongs to. It must pass the props and the ref it
   * is given down to a real element, as every design-system control does.
   */
  readonly children: ReactNode;
}

/** A hint shown on hover or focus of the control it wraps. */
export function Tooltip({ label, detail, shortcut, children }: TooltipProps): ReactNode {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      {hintSurface(label, shortcut, detail)}
    </RadixTooltip.Root>
  );
}

/**
 * Enables tooltips for everything inside.
 *
 * One provider per application, so that moving between controls shows the
 * second hint immediately rather than waiting through the opening delay again.
 */
export function HintProvider({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <RadixTooltip.Provider delayDuration={500} skipDelayDuration={250}>
      {children}
    </RadixTooltip.Provider>
  );
}
