/**
 * The reason a dial cannot be used now (ADR-0013), kept where its person can
 * reach it: shown as a hint while the pointer or the keyboard is on the
 * control, and said with the control's name by a screen reader, since an
 * unavailable dial keeps its focus rather than dropping out of the order.
 */

import { Tooltip } from 'radix-ui';
import type { ReactElement, ReactNode } from 'react';

import { hintSurface } from '../overlays/tooltips.js';

/** A dial and the reason it is unavailable, if it is. */
export interface UnavailableReasonProps {
  /** The id the control names in its `aria-describedby` while it is unavailable. */
  readonly id: string;

  readonly reason: string | undefined;

  /** The focusable part of the control, which the hint opens against. */
  readonly children: ReactElement;
}

/**
 * The control, with its reason as a hint and as its description while it is
 * unavailable, and the control alone otherwise.
 */
export function UnavailableReason({ id, reason, children }: UnavailableReasonProps): ReactNode {
  if (reason === undefined) return children;
  return (
    <>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        {hintSurface(reason)}
      </Tooltip.Root>
      <span id={id} className="ag-visually-hidden">
        {reason}
      </span>
    </>
  );
}
