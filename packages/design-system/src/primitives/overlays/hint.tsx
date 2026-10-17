/**
 * The hint: a small (i) beside a control or a heading, whose popover holds the
 * explanation a panel would otherwise print (design language, section 13).
 */

import type { ReactNode } from 'react';

import { Icon, IconSize } from '../../icons/icon.js';
import { InfoPopover } from './info-popover.js';

/** What a hint takes. */
export interface HintProps {
  /**
   * The (i)'s accessible name, which says what it explains, such as "About
   * monitoring". Also the popover's.
   */
  readonly label: string;

  /** A title over the explanation. */
  readonly title?: string;

  /** The explanation. */
  readonly children: ReactNode;
}

/** An (i) that opens an explanation. */
export function Hint({ label, title, children }: HintProps): ReactNode {
  return (
    <InfoPopover
      label={label}
      {...(title === undefined ? {} : { title })}
      trigger={
        <button type="button" className="ag-hint ag-touch-target" aria-label={label}>
          <Icon name="hint" size={IconSize.Inline} />
        </button>
      }
    >
      {children}
    </InfoPopover>
  );
}
