/**
 * The bar along the top of the application: the product's mark and name, the
 * menus, and the button that opens the command palette (design language,
 * section 1, and the approved Editing workspace).
 */

import type { ReactNode } from 'react';

import {
  Button,
  ButtonTone,
  ControlBar,
  ControlBarItem,
  Icon,
  MenuBar,
  MenuBarMenu,
  ShortcutKeys,
} from '@audiogubbins/design-system';

import type { ShellMenu } from './menus.js';

/** What the bar along the top takes. */
export interface MenuBarRowProps {
  readonly menus: readonly ShellMenu[];

  /** The palette's shortcut, written for the platform, where it has one. */
  readonly paletteShortcut: string | undefined;

  /** Opens the command palette. */
  readonly onCommands: () => void;
}

/**
 * The menu bar row.
 *
 * Its `h1` is the document's one, and the name the menu bar shows. Every panel
 * titles itself with an `h2` and the too-narrow notice does too, so without it
 * the heading structure would begin at the second level with nothing above it,
 * and below the declared width it would be a single `h2` alone. Written as a
 * hidden heading of its own it would stand between the banner and the main
 * region, belonging to neither, so a reader moving by landmark would never
 * meet it and the name would be on the page twice.
 *
 * The menus and the actions beside them are separate bars, because they are
 * separate things to a screen reader: a menu bar holds menus and nothing else.
 * A button that runs a command is not a menu, so it sits in its own toolbar
 * rather than pretending.
 *
 * The palette's button is drawn as the field the palette opens to, its glyph,
 * its name and its shortcut's keys, and named by its label alone: the keys are
 * the tooltip's to say as well, and a name that read them out would no longer
 * be the button's name.
 */
export function MenuBarRow({ menus, paletteShortcut, onCommands }: MenuBarRowProps): ReactNode {
  return (
    <header className="ag-menu-bar">
      <h1 className="ag-product-name">
        <span className="ag-product-mark">
          <Icon name="application" />
        </span>
        AudioGubbins
      </h1>
      <MenuBar label="Main menu">
        {menus.map((menu) => (
          <MenuBarMenu key={menu.label} label={menu.label} groups={menu.groups} />
        ))}
      </MenuBar>
      <ControlBar label="Quick actions">
        <ControlBarItem>
          <Button
            tone={ButtonTone.Quiet}
            compact
            label="Commands"
            hint="Run a command"
            {...(paletteShortcut === undefined ? {} : { shortcut: paletteShortcut })}
            onClick={onCommands}
          >
            <Icon name="search" />
            <span className="ag-commands-label">Commands</span>
            {paletteShortcut !== undefined && <ShortcutKeys shortcut={paletteShortcut} />}
          </Button>
        </ControlBarItem>
      </ControlBar>
    </header>
  );
}
