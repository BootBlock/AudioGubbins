/**
 * A status chip: a state told in a word and a glyph, in its colour at about a
 * fifth with a translucent edge (design language, section 10, "Status item").
 *
 * A state keeps its own hue whatever the accent, so a reader never has to
 * remember which colour they chose, and the word says it as well as the
 * colour does.
 */

import type { ReactNode } from 'react';

import { Icon, IconSize } from '../../icons/icon.js';
import type { IconName } from '../../icons/vocabulary.js';

/** What a status chip says. */
export const StatusTone = {
  /** Plain text, no fill. */
  Neutral: 'neutral',

  /** A mode that is on, such as monitoring. */
  Accent: 'accent',

  /** Success is told by its colour as text, without a fill. */
  Success: 'success',

  Warning: 'warning',
  Error: 'error',

  /** Recording: led by the recording lamp, which breathes at the full level. */
  Recording: 'recording',
} as const;

/** What a status chip says. */
export type StatusTone = (typeof StatusTone)[keyof typeof StatusTone];

/** What a status chip takes. */
export interface StatusChipProps {
  readonly tone: StatusTone;

  /** Its glyph. A recording chip is led by its lamp instead. */
  readonly icon?: IconName;

  readonly children: ReactNode;
}

/** A status chip. */
export function StatusChip({ tone, icon, children }: StatusChipProps): ReactNode {
  return (
    <span className="ag-status-chip" data-ag-tone={tone}>
      {tone === StatusTone.Recording ? (
        <span className="ag-status-chip-lamp" aria-hidden="true" />
      ) : (
        icon !== undefined && <Icon name={icon} size={IconSize.Inline} />
      )}
      <span>{children}</span>
    </span>
  );
}
