/**
 * What a panel shows when it has nothing to show, or could not show it: a
 * mark, a title, at most one line, and the action that fills it (design
 * language, section 9).
 *
 * Empty, warning and error are one layout in three colours, so two panels in
 * the same state look alike. An error says what failed in its title, why in
 * its line, and offers the way to try again.
 */

import type { ReactNode } from 'react';

import { Icon, IconSize } from '../../icons/icon.js';
import type { IconName } from '../../icons/vocabulary.js';
import { Heading, type HeadingLevel } from '../heading.js';

/** Which state a panel is in. */
export const PanelStateTone = {
  /** Nothing to show yet: the accent. */
  Empty: 'empty',

  /** Something to look at that still works: the warning colour. */
  Warning: 'warning',

  /** It failed: the error colour. */
  Error: 'error',
} as const;

/** Which state a panel is in. */
export type PanelStateTone = (typeof PanelStateTone)[keyof typeof PanelStateTone];

/** What an empty state takes. */
export interface EmptyStateProps {
  readonly tone?: PanelStateTone;

  /** The glyph in its mark. */
  readonly icon: IconName;

  /** What is so, in a few words: "No audio yet". */
  readonly title: string;

  /**
   * The title's heading level in the surface's outline, so a reader moving by
   * heading finds the state. Left out, the title is a plain line, for a state
   * inside something that already has a heading of its own.
   */
  readonly headingLevel?: HeadingLevel;

  /** One line more: what to do, or why it failed. */
  readonly text?: string;

  /** A call to action and, at most, one secondary button. */
  readonly actions?: ReactNode;
}

/** A panel's empty, warning or error state. */
export function EmptyState({
  tone = PanelStateTone.Empty,
  icon,
  title,
  headingLevel,
  text,
  actions,
}: EmptyStateProps): ReactNode {
  return (
    <div className="ag-empty-state" data-ag-tone={tone}>
      <span className="ag-empty-state-mark">
        <Icon name={icon} size={IconSize.Mark} />
      </span>
      {headingLevel === undefined ? (
        <p className="ag-empty-state-title">{title}</p>
      ) : (
        <Heading level={headingLevel} className="ag-empty-state-title">
          {title}
        </Heading>
      )}
      {text !== undefined && <p className="ag-empty-state-text">{text}</p>}
      {actions !== undefined && <div className="ag-empty-state-actions">{actions}</div>}
    </div>
  );
}
