/**
 * A set of tabs over shared space.
 *
 * Radix supplies the roles and the arrow keys; this adds the language's tab:
 * the panel's glyph before the label, and the active tab drawn as a
 * translucent wash of the accent with a faint accent edge (design language,
 * sections 6 and 10). Set vertically, as Settings lists its pages, the tabs
 * are a column of rows beside what they show, and the chosen one is lit as a
 * chosen row is, by the lit edge (section 7), with the up and down arrows.
 */

import { Tabs } from 'radix-ui';
import type { ReactNode } from 'react';

import { Icon } from '../../icons/icon.js';
import type { IconName } from '../../icons/vocabulary.js';

/** Which way the tabs run. */
export const TabOrientation = {
  /** A strip over what they show: a panel's or a dialogue's tabs. */
  Horizontal: 'horizontal',

  /** A column of rows beside what they show: Settings' pages. */
  Vertical: 'vertical',
} as const;

/** Which way the tabs run. */
export type TabOrientation = (typeof TabOrientation)[keyof typeof TabOrientation];

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

  /** Which way the tabs run. Horizontal when left out. */
  readonly orientation?: TabOrientation;
}

/**
 * The classes a tab is drawn with. A vertical tab is a row of a column, which
 * grows for a finger rather than widening its hit area over the rows beside
 * it, and is lit as a chosen row by the lit edge, which draws on the place
 * the widened area would take.
 */
const TAB_CLASS: Readonly<Record<TabOrientation, string>> = {
  horizontal: 'ag-tab ag-touch-target',
  vertical: 'ag-nav-tab ag-lit-row ag-touch-sized',
};

/** A set of tabs over shared space. */
export function TabSet({
  label,
  tabs,
  value,
  onValueChange,
  orientation = TabOrientation.Horizontal,
}: TabSetProps): ReactNode {
  return (
    <Tabs.Root
      className="ag-tabs"
      value={value}
      onValueChange={onValueChange}
      orientation={orientation}
    >
      <Tabs.List className="ag-tab-list" aria-label={label}>
        {tabs.map((tab) => (
          <Tabs.Trigger key={tab.value} value={tab.value} className={TAB_CLASS[orientation]}>
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
