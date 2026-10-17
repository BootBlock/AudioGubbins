/**
 * A menu opened by pressing a control.
 *
 * Radix supplies the hard parts every floating surface shares: focus moves in
 * and back out to where it started, Escape closes it, and a screen reader is
 * told what appeared. AudioGubbins wraps it so the solution is applied
 * consistently and no feature imports Radix directly (REQ-UX-155).
 */

import { DropdownMenu } from 'radix-ui';
import { useId, type ReactNode } from 'react';

import {
  glyphColumn,
  hasGlyphs,
  menuGroups,
  menuItemContent,
  menuItemProps,
  type MenuGroup,
} from './menu-entries.js';

/** What a dropdown menu takes. */
export interface DropdownMenuProps {
  /** The control that opens the menu. */
  readonly trigger: ReactNode;

  readonly groups: readonly MenuGroup[];

  /** The accessible name of the menu itself. */
  readonly label: string;
}

/** The entries of a dropdown menu. */
function menuGroupsContent(groups: readonly MenuGroup[], idPrefix: string): ReactNode {
  const glyphs = hasGlyphs(groups);
  return menuGroups(groups, idPrefix, {
    item: (item, describedBy) => (
      <DropdownMenu.Item key={item.key} {...menuItemProps(item, describedBy)}>
        {menuItemContent(item, glyphs)}
      </DropdownMenu.Item>
    ),
    separator: (key) => <DropdownMenu.Separator key={key} className="ag-menu-separator" />,
    label: (key, id, text) => (
      <DropdownMenu.Label key={key} id={id} className="ag-menu-label">
        {text}
      </DropdownMenu.Label>
    ),
  });
}

/** A menu opened by pressing a control. */
export function Menu({ trigger, groups, label }: DropdownMenuProps): ReactNode {
  const idPrefix = useId();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="ag-menu ag-overlay"
          aria-label={label}
          sideOffset={4}
          {...glyphColumn(groups)}
        >
          {menuGroupsContent(groups, idPrefix)}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
