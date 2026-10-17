/**
 * A section of a panel: a hairline above a quiet header that opens and closes
 * what is under it (design language, section 11, item 4).
 *
 * Advanced settings sit in a closed section rather than being removed
 * (REQ-UX-071), so every section can be opened, by its header, from the
 * keyboard as well as the pointer: Radix's collapsible supplies the button and
 * its expanded state.
 */

import { Collapsible } from 'radix-ui';
import { useId, type ReactNode } from 'react';

import { Icon, IconSize } from '../../icons/icon.js';
import type { IconName } from '../../icons/vocabulary.js';

/** Whether a section is open, held by its caller. */
interface Held {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly defaultOpen?: never;
}

/** Whether a section is open, held by the section itself. */
interface OwnState {
  readonly open?: never;
  readonly onOpenChange?: (open: boolean) => void;

  /** Whether it starts open. Open unless this says `false`. */
  readonly defaultOpen?: boolean;
}

/** What a section takes. */
export type SectionProps = (Held | OwnState) & {
  /** Its header's words, which name the button that opens it. */
  readonly title: string;

  /** A glyph before the title. */
  readonly icon?: IconName;

  /**
   * What it holds, said in a few words after the title, so a closed section
   * still tells the reader what is in it. It wraps rather than being cut.
   */
  readonly summary?: string;

  /** Small buttons at the header's trailing end. */
  readonly actions?: ReactNode;

  readonly children: ReactNode;
};

/** A section of a panel, open or closed. */
export function Section(props: SectionProps): ReactNode {
  const { title, icon, summary, actions, children } = props;
  const summaryId = useId();
  const state =
    props.open === undefined
      ? {
          defaultOpen: props.defaultOpen ?? true,
          ...(props.onOpenChange === undefined ? {} : { onOpenChange: props.onOpenChange }),
        }
      : { open: props.open, onOpenChange: props.onOpenChange };

  return (
    <Collapsible.Root className="ag-section" {...state}>
      <div className="ag-section-header">
        <Collapsible.Trigger
          className="ag-section-trigger"
          aria-describedby={summary === undefined ? undefined : summaryId}
        >
          <Icon name="expand" size={IconSize.Inline} className="ag-section-chevron" />
          {icon !== undefined && <Icon name={icon} size={IconSize.Inline} />}
          <span>{title}</span>
        </Collapsible.Trigger>
        {summary !== undefined && (
          <span className="ag-section-summary" id={summaryId}>
            {summary}
          </span>
        )}
        {actions !== undefined && <div className="ag-section-actions">{actions}</div>}
      </div>
      <Collapsible.Content className="ag-section-content">
        <div className="ag-section-inner">{children}</div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
