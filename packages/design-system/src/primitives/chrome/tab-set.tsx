/**
 * A set of tabs over shared space.
 *
 * Radix supplies the roles and the arrow keys; this adds the language's tab:
 * the panel's glyph before the label, and the active tab drawn as a
 * translucent wash of the accent with a faint accent edge (design language,
 * sections 6 and 10).
 */

import { Tabs } from 'radix-ui';
import type { ReactNode } from 'react';

import { Icon } from '../../icons/icon.js';
import type { IconName } from '../../icons/vocabulary.js';

/** One tab and what it shows. */
export interface TabDescriptor {
  readonly value: string;
  readonly label: string;
  readonly content: ReactNode;

  /** The glyph before the label, which turns accent while the tab is active. */
  readonly icon?: IconName;
}

/** What a tab set takes. */
export interface TabSetProps {
  /** The accessible name of the tab list. */
  readonly label: string;

  readonly tabs: readonly TabDescriptor[];
  readonly value: string;
  readonly onValueChange: (value: string) => void;
}

/** A set of tabs over shared space. */
export function TabSet({ label, tabs, value, onValueChange }: TabSetProps): ReactNode {
  return (
    <Tabs.Root className="ag-tabs" value={value} onValueChange={onValueChange}>
      <Tabs.List className="ag-tab-list" aria-label={label}>
        {tabs.map((tab) => (
          <Tabs.Trigger key={tab.value} value={tab.value} className="ag-tab ag-touch-target">
            {tab.icon !== undefined && <Icon name={tab.icon} />}
            <span className="ag-tab-label">{tab.label}</span>
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {tabs.map((tab) => (
        <Tabs.Content key={tab.value} value={tab.value} className="ag-tab-panel">
          {tab.content}
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}
