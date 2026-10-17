/**
 * A panel's header: its glyph and title drawn as the panel's own active tab,
 * an optional sub-line after it, and the panel's actions at the trailing end
 * (design language, section 10, "Tabs and panel headers").
 *
 * The actions are full-size targets, an icon button of the control's height,
 * so their ink sits as far from the panel's side as from its top; the header
 * lays them out and leaves drawing them to the button.
 */

import type { ReactNode } from 'react';

import { Icon } from '../../icons/icon.js';
import type { IconName } from '../../icons/vocabulary.js';

/** What a panel header takes. */
export interface PanelHeaderProps {
  /** The panel's name. */
  readonly title: string;

  /** The panel's glyph, before its title, in the accent. */
  readonly icon: IconName;

  /**
   * A line after the title at label size: a count, or the take being heard.
   * It wraps under the title where the header is narrow, and is never cut.
   */
  readonly subLabel?: ReactNode;

  /** The panel's actions: icon buttons at the control's full height. */
  readonly actions?: ReactNode;
}

/** A panel's header. */
export function PanelHeader({ title, icon, subLabel, actions }: PanelHeaderProps): ReactNode {
  return (
    <header className="ag-panel-header">
      <h2 className="ag-panel-heading">
        <Icon name={icon} />
        <span>{title}</span>
      </h2>
      {subLabel !== undefined && <span className="ag-panel-sub-label">{subLabel}</span>}
      {actions !== undefined && <div className="ag-panel-actions">{actions}</div>}
    </header>
  );
}
