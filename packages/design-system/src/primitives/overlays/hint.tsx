/**
 * The hint: a small (i) beside a control or a heading, whose popover holds the
 * explanation a panel would otherwise print (design language, section 13).
 *
 * Its tone says what kind of explanation waits behind it: an ordinary one, a
 * caution about something that still works, or why something failed. The
 * glyph and its colour change with the tone, so a warning behind a hint is
 * seen before it is opened, and its popover's title takes the same glyph.
 */

import type { ReactNode } from 'react';

import { Icon, IconSize } from '../../icons/icon.js';
import type { IconName } from '../../icons/vocabulary.js';
import { InfoPopover, PopoverTone } from './info-popover.js';

/** What kind of explanation a hint holds. */
export const HintTone = {
  /** An ordinary explanation: the (i), in the text colour. */
  Information: 'information',

  /** A caution about something that still works: the warning glyph and colour. */
  Warning: 'warning',

  /** Why something failed: the error glyph and colour. */
  Error: 'error',
} as const;

/** What kind of explanation a hint holds. */
export type HintTone = (typeof HintTone)[keyof typeof HintTone];

/** Each tone's glyph, and the popover it opens. */
const TONE: Readonly<Record<HintTone, { readonly glyph: IconName; readonly popover: PopoverTone }>> =
  {
    information: { glyph: 'hint', popover: PopoverTone.Plain },
    warning: { glyph: 'warning', popover: PopoverTone.Warning },
    error: { glyph: 'error', popover: PopoverTone.Error },
  };

/** What a hint takes. */
export interface HintProps {
  /**
   * The (i)'s accessible name, which says what it explains, such as "About
   * monitoring". Also the popover's.
   */
  readonly label: string;

  /** A title over the explanation. */
  readonly title?: string;

  /** What kind of explanation it holds. Information when left out. */
  readonly tone?: HintTone;

  /** The explanation. */
  readonly children: ReactNode;
}

/** An (i) that opens an explanation. */
export function Hint({
  label,
  title,
  tone = HintTone.Information,
  children,
}: HintProps): ReactNode {
  const { glyph, popover } = TONE[tone];
  return (
    <InfoPopover
      label={label}
      tone={popover}
      {...(title === undefined ? {} : { title })}
      {...(tone === HintTone.Information ? {} : { icon: glyph })}
      trigger={
        <button
          type="button"
          className="ag-hint ag-touch-target"
          data-ag-tone={tone}
          aria-label={label}
        >
          <Icon name={glyph} size={IconSize.Inline} />
        </button>
      }
    >
      {children}
    </InfoPopover>
  );
}
