/**
 * The application menu bar.
 *
 * A menu bar is not a row of menu buttons. It is one Tab stop, the arrow keys
 * move between the menus, an open menu follows the arrow keys from one menu to
 * the next, and the rest of the application stays reachable while a menu is
 * open. The `menubar` role says all of that to an assistive technology, and
 * Radix's menu bar supplies the behaviour that the role promises (REQ-UX-005).
 *
 * Building the same thing from a toolbar and separate menus does not arrive at
 * the same place. The trigger has to be the toolbar's item and the menu's
 * trigger at once, and merging two components onto one button only works while
 * every component in the chain passes what it is given down to a real element.
 * It can fail in two ways, both of which an accessibility audit of the running
 * application reports: a trigger that never becomes a toolbar item at all, and
 * a modal menu that makes the whole page `aria-hidden` while leaving its own
 * trigger focusable inside the hidden part.
 */

import { Menubar } from 'radix-ui';
import { useId, type ReactNode } from 'react';

import { Button, ButtonTone } from './button.js';
import { menuGroups, menuItemContent, menuItemProps, type MenuGroup } from './overlays.js';

/** What a menu bar takes. */
export interface MenuBarProps {
  /** The accessible name, for example "Main menu". */
  readonly label: string;

  /** The menus, which must be {@link MenuBarMenu}. */
  readonly children: ReactNode;
}

/** The row of menus along the top of the application. */
export function MenuBar({ label, children }: MenuBarProps): ReactNode {
  return (
    <Menubar.Root className="ag-menu-bar-root" aria-label={label}>
      {children}
    </Menubar.Root>
  );
}

/** What a menu-bar menu takes. */
export interface MenuBarMenuProps {
  /** The visible label, and the menu's accessible name. */
  readonly label: string;

  readonly groups: readonly MenuGroup[];
}

/** One menu of a {@link MenuBar}. */
export function MenuBarMenu({ label, groups }: MenuBarMenuProps): ReactNode {
  const idPrefix = useId();
  return (
    <Menubar.Menu>
      <Menubar.Trigger asChild>
        <Button tone={ButtonTone.Quiet} compact>
          {label}
        </Button>
      </Menubar.Trigger>

      <Menubar.Portal>
        <Menubar.Content className="ag-menu" aria-label={label} sideOffset={4}>
          {menuGroups(groups, idPrefix, {
            item: (item, describedBy) => (
              <Menubar.Item key={item.key} {...menuItemProps(item, describedBy)}>
                {menuItemContent(item)}
              </Menubar.Item>
            ),
            separator: (key) => <Menubar.Separator key={key} className="ag-menu-separator" />,
            label: (key, id, text) => (
              <Menubar.Label key={key} id={id} className="ag-menu-label">
                {text}
              </Menubar.Label>
            ),
          })}
        </Menubar.Content>
      </Menubar.Portal>
    </Menubar.Menu>
  );
}
