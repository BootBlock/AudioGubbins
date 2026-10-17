/**
 * A badge: a pill of a word or two at caption size (design language,
 * section 10, "Notices, tooltips and hints").
 *
 * A tone badge is its colour at a high translucency with a translucent edge,
 * never a solid fill, so the glass shows through it.
 */

import type { ReactNode } from 'react';

import { Icon, IconSize } from '../../icons/icon.js';
import type { IconName } from '../../icons/vocabulary.js';

/** What a badge's colour says. */
export const BadgeTone = {
  Neutral: 'neutral',
  Accent: 'accent',
  Success: 'success',
  Warning: 'warning',
  Error: 'error',
} as const;

/** What a badge's colour says. */
export type BadgeTone = (typeof BadgeTone)[keyof typeof BadgeTone];

/** What a badge takes. */
export interface BadgeProps {
  readonly tone?: BadgeTone;

  /** A small glyph before the words. */
  readonly icon?: IconName;

  readonly children: ReactNode;
}

/** A badge. */
export function Badge({ tone = BadgeTone.Neutral, icon, children }: BadgeProps): ReactNode {
  return (
    <span className="ag-badge" data-ag-tone={tone}>
      {icon !== undefined && <Icon name={icon} size={IconSize.Small} />}
      {children}
    </span>
  );
}
