/**
 * A banner: a standing state the reader should know about, such as a project
 * open to read only, across the top of what it concerns (design language,
 * section 10, "Notices, tooltips and hints").
 *
 * Its tone's colour at a high translucency over glass, a translucent edge and
 * a soft glow of the same colour. Its sentence wraps and is never cut short.
 */

import type { ReactNode } from 'react';

import { Icon } from '../../icons/icon.js';
import type { IconName } from '../../icons/vocabulary.js';
import { Spinner } from './spinner.js';

/** What a banner is about. */
export const BannerTone = {
  /** Information: the accent. */
  Information: 'information',

  Success: 'success',
  Warning: 'warning',
  Error: 'error',
} as const;

/** What a banner is about. */
export type BannerTone = (typeof BannerTone)[keyof typeof BannerTone];

/** What a banner takes. */
export interface BannerProps {
  readonly tone?: BannerTone;

  /**
   * Its glyph, or `busy` for a spinner while what it describes is under way,
   * such as a project opening.
   */
  readonly icon: IconName | 'busy';

  /** A few words at 600 before the sentence. */
  readonly title?: string;

  /** The sentence, which wraps. */
  readonly children?: ReactNode;

  /** Small buttons at its trailing end. */
  readonly actions?: ReactNode;
}

/** A banner. */
export function Banner({
  tone = BannerTone.Information,
  icon,
  title,
  children,
  actions,
}: BannerProps): ReactNode {
  return (
    <div className="ag-banner" data-ag-tone={tone}>
      {icon === 'busy' ? <Spinner /> : <Icon name={icon} className="ag-banner-glyph" />}
      <p className="ag-banner-text">
        {title !== undefined && <strong className="ag-banner-title">{title}</strong>}
        {children !== undefined && <span className="ag-banner-sentence">{children}</span>}
      </p>
      {actions !== undefined && <div className="ag-banner-actions">{actions}</div>}
    </div>
  );
}
