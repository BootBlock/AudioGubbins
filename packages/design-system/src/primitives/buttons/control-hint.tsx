/**
 * What a control says when it is hovered or focused: its hint, or, while it
 * cannot be used, the reason why (ADR-0013).
 *
 * An unavailable control keeps its place in the tab order and opens its reason
 * on hover or focus, so a keyboard user reaches the reason as a pointer user
 * does (design language, section 13). The reason is also the control's
 * description, held in the page whether or not the surface is open, so a
 * screen reader says it as the control is reached rather than only once a
 * pointer has rested on it.
 */

import { Tooltip } from 'radix-ui';
import { useId, useState, type ReactElement, type ReactNode } from 'react';

import { Icon, IconSize } from '../../icons/icon.js';
import { hintSurface } from '../overlays.js';

/**
 * How long a pointer rests before a hint opens, and how soon the next opens
 * after one closes: the values `HintProvider` gives the application's other
 * hints, so a control's hint keeps their timing. Focus opens one at once.
 */
const OPEN_DELAY_MS = 500;
const SKIP_DELAY_MS = 250;

/** What the trigger takes to be described by the reason. */
export interface Described {
  /** The reason's element, while the control cannot be used. */
  readonly reasonId: string | undefined;
}

/** What a control hint takes. */
export interface ControlHintProps {
  /** The hint shown on hover or focus while the control can be used. */
  readonly hint?: string | undefined;

  /** The shortcut, shown after the hint (REQ-UX-066). */
  readonly shortcut?: string | undefined;

  /** Why the control cannot be used now, or `undefined` while it can. */
  readonly unavailableReason?: string | undefined;

  /**
   * Draws the control, given the reason's element to describe it by. The
   * element it returns must pass the props and the ref it is given to a real
   * element, because the surface opens against it.
   */
  readonly children: (described: Described) => ReactElement;
}

/** The surface saying why a control cannot be used, with the unavailable glyph. */
function reasonSurface(reason: string): ReactNode {
  return (
    <Tooltip.Portal>
      <Tooltip.Content className="ag-tooltip ag-control-reason" sideOffset={6}>
        <Icon name="unavailable" size={IconSize.Inline} className="ag-control-reason-glyph" />
        {reason}
        <Tooltip.Arrow className="ag-tooltip-arrow" />
      </Tooltip.Content>
    </Tooltip.Portal>
  );
}

/**
 * Opens a control's hint, or its unavailable reason, on hover or focus.
 *
 * Always composed, whether or not there is anything to say, so a control that
 * becomes unavailable while focused keeps its element and its focus: a tree
 * that grew a wrapper only once there was a reason would mount the control
 * again, and focus would fall to the page. It carries a provider of its own so
 * a control drawn outside `HintProvider`, as a test or an isolated surface
 * draws one, still has the context the hint needs.
 */
export function ControlHint({
  hint,
  shortcut,
  unavailableReason,
  children,
}: ControlHintProps): ReactNode {
  const reasonId = useId();
  const [open, setOpen] = useState(false);
  const surface =
    unavailableReason !== undefined
      ? reasonSurface(unavailableReason)
      : hint !== undefined
        ? hintSurface(hint, shortcut)
        : undefined;

  return (
    <Tooltip.Provider delayDuration={OPEN_DELAY_MS} skipDelayDuration={SKIP_DELAY_MS}>
      <Tooltip.Root open={surface !== undefined && open} onOpenChange={setOpen}>
        <Tooltip.Trigger asChild>
          {children({ reasonId: unavailableReason === undefined ? undefined : reasonId })}
        </Tooltip.Trigger>
        {surface}
      </Tooltip.Root>
      {unavailableReason !== undefined && (
        <span id={reasonId} className="ag-visually-hidden">
          {unavailableReason}
        </span>
      )}
    </Tooltip.Provider>
  );
}

/**
 * The `aria-describedby` of a control described by several elements, or
 * nothing where none describes it.
 */
export function describedBy(...ids: readonly (string | undefined)[]): {
  readonly 'aria-describedby'?: string;
} {
  const joined = ids.filter((id) => id !== undefined && id !== '').join(' ');
  return joined === '' ? {} : { 'aria-describedby': joined };
}
