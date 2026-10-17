/**
 * The popover: a non-modal surface holding an explanation or a few controls,
 * opened from a control and closed by Escape, a press outside or the control
 * again, with focus given back to the control.
 */

import { Popover } from 'radix-ui';
import type { ReactNode } from 'react';

import { Icon, IconSize } from '../../icons/icon.js';
import type { IconName } from '../../icons/vocabulary.js';

/** Whether a popover explains, or gives the reason something cannot be done. */
export const PopoverTone = {
  Plain: 'plain',

  /** Why a control is unavailable (ADR-0013): its glyph is in the warning colour. */
  Reason: 'reason',
} as const;

/** Whether a popover explains, or gives the reason something cannot be done. */
export type PopoverTone = (typeof PopoverTone)[keyof typeof PopoverTone];

/** What a popover takes. */
export interface InfoPopoverProps {
  readonly trigger: ReactNode;

  /** The popover's accessible name. */
  readonly label: string;

  /** A title over the text, with its glyph. */
  readonly title?: string;
  readonly icon?: IconName;
  readonly tone?: PopoverTone;

  readonly children: ReactNode;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}

/** The inside of a popover, for a surface that places it itself. */
export function PopoverBody({
  title,
  icon,
  children,
}: Pick<InfoPopoverProps, 'title' | 'icon' | 'children'>): ReactNode {
  return (
    <>
      {title !== undefined && (
        <p className="ag-popover-title">
          {icon !== undefined && <Icon name={icon} size={IconSize.Inline} />}
          {title}
        </p>
      )}
      {children}
    </>
  );
}

/** A non-modal surface holding controls or an explanation. */
export function InfoPopover({
  trigger,
  label,
  title,
  icon,
  tone = PopoverTone.Plain,
  children,
  open,
  onOpenChange,
}: InfoPopoverProps): ReactNode {
  // Spread rather than pass, because Radix distinguishes an absent `open` prop
  // (it manages its own state) from one set to `undefined`. Under
  // exactOptionalPropertyTypes those are different things, which is the point.
  const controlled = {
    ...(open === undefined ? {} : { open }),
    ...(onOpenChange === undefined ? {} : { onOpenChange }),
  };

  return (
    <Popover.Root {...controlled}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="ag-popover ag-overlay"
          aria-label={label}
          data-ag-tone={tone}
          sideOffset={6}
        >
          <PopoverBody
            {...(title === undefined ? {} : { title })}
            {...(icon === undefined ? {} : { icon })}
          >
            {children}
          </PopoverBody>
          <Popover.Arrow className="ag-popover-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
