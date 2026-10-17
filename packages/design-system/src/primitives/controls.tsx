/**
 * The tab set, and the text a screen reader hears that no one sees. The slider
 * is `value-slider.tsx`, the switches and toolbars are under `buttons/`, and the
 * select and the text field are under `fields/`.
 *
 * The tab set wraps Radix's, which supplies the keyboard behaviour and the ARIA
 * roles, and keeps a touch target that does not shrink with the density
 * (REQ-UX-005, REQ-UX-067, REQ-UX-071).
 */

import { Tabs } from 'radix-ui';
import type { ReactNode } from 'react';

/** One tab and what it shows. */
export interface TabDescriptor {
  readonly value: string;
  readonly label: string;
  readonly content: ReactNode;
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
            {tab.label}
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

/** Text present for a screen reader and absent for everyone else. */
export function VisuallyHidden({ children }: { readonly children: ReactNode }): ReactNode {
  return <span className="ag-visually-hidden">{children}</span>;
}
