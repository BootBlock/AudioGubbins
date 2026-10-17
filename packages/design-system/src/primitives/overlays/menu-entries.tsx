/**
 * The entries every kind of menu draws: a dropdown menu, a context menu and a
 * menu of the menu bar take the same descriptors and lay them out the same
 * way, so a command looks and reads alike wherever it is offered.
 */

import type { ReactNode } from 'react';

import { Icon } from '../../icons/icon.js';
import type { IconName } from '../../icons/vocabulary.js';
import { ShortcutKeys } from './shortcut-keys.js';

/** One entry in a menu. */
export interface MenuItemDescriptor {
  /** Stable key, usually the identifier of the command the entry runs. */
  readonly key: string;

  readonly label: string;

  /** The glyph drawn before the label, where the entry has one. */
  readonly icon?: IconName;

  /** The shortcut, already written for the platform (REQ-UX-066). */
  readonly shortcut?: string;

  /** Why the entry cannot be chosen, when it cannot. */
  readonly unavailableReason?: string;

  readonly onSelect: () => void;
}

/** A group of entries, drawn with a separator between groups. */
export interface MenuGroup {
  readonly key: string;

  /**
   * What the group's entries are, shown at its head and read with each entry.
   *
   * For a group whose entries are bare names: without it, a list of workspaces
   * and a list of panels eight rows apart would draw "Editing" and "Editor"
   * alike, and a screen reader would hear "Editing, menu item" with nothing to
   * say it would switch the workspace rather than open a panel.
   */
  readonly label?: string;

  readonly items: readonly MenuItemDescriptor[];
}

/**
 * Whether any entry of a menu has a glyph, which gives every entry a glyph
 * column, so the labels of a menu share one edge whether or not their own
 * entry has a glyph.
 */
export function hasGlyphs(groups: readonly MenuGroup[]): boolean {
  return groups.some((group) => group.items.some((item) => item.icon !== undefined));
}

/**
 * The visible content of one menu entry.
 *
 * Shared because the label and the shortcut sit the same way in every menu
 * kind. The entry element itself is not shared: a dropdown entry and a context
 * entry are different Radix components with different types, and forcing one to
 * stand in for the other would need an assertion that the compiler is right to
 * refuse.
 *
 * The label, the shortcut and the reason stay in that order in the text, which
 * is the entry's accessible name; the stylesheet places the reason under the
 * label.
 */
export function menuItemContent(item: MenuItemDescriptor, glyphs: boolean): ReactNode {
  return (
    <>
      {glyphs &&
        (item.icon === undefined ? (
          <span className="ag-menu-item-glyph" aria-hidden="true" />
        ) : (
          <Icon name={item.icon} className="ag-menu-item-glyph" />
        ))}
      <span className="ag-menu-item-label">{item.label}</span>
      {item.shortcut !== undefined && (
        <ShortcutKeys shortcut={item.shortcut} className="ag-menu-item-shortcut" />
      )}

      {/*
        The reason as text, as the command palette shows it.

        Carried only by `aria-description`, an ARIA 1.3 attribute that Gecko and
        WebKit do not implement, on an element the roving focus and the
        typeahead both skip while it is disabled, it would be heard by nobody
        outside Chromium and seen by nobody anywhere: the entry would be dimmed
        and silent. Text is read by every assistive technology, because it is
        part of the entry's accessible name.
      */}
      {item.unavailableReason !== undefined && (
        <span className="ag-menu-item-reason">{item.unavailableReason}</span>
      )}
    </>
  );
}

/**
 * What every menu gives an entry: its class, its group's label as its
 * description, and a handler that runs it.
 *
 * An entry that cannot be chosen stays where the keyboard can reach it, marked
 * `aria-disabled` and doing nothing when chosen. Disabled the way the menu
 * library disables an entry, it would be passed over by the arrow keys and the
 * typeahead, so its reason, which is often the only thing in a menu that says
 * what is in force ("The dark theme is already in use."), would be seen by a
 * mouse user and never reached by a keyboard or a screen reader. The ARIA
 * practices keep a disabled menu entry focusable for the same reason.
 */
export function menuItemProps(item: MenuItemDescriptor, describedBy: string | undefined) {
  const unavailable = item.unavailableReason !== undefined;
  return {
    className: 'ag-menu-item ag-lit-row ag-touch-sized',
    'aria-describedby': describedBy,
    ...(unavailable ? { 'aria-disabled': true, 'data-ag-unavailable': '' } : {}),
    onSelect: (event: Event) => {
      // Kept open, as a disabled entry's menu is, with nothing run.
      if (unavailable) {
        event.preventDefault();
        return;
      }
      item.onSelect();
    },
  };
}

/** How one kind of menu draws the parts of a group. */
export interface MenuGroupParts {
  /** An entry, described by its group's label when the group has one. */
  readonly item: (item: MenuItemDescriptor, describedBy: string | undefined) => ReactNode;
  readonly separator: (key: string) => ReactNode;

  /** A group's label: the menu's own label element, which takes no focus. */
  readonly label: (key: string, id: string, text: string) => ReactNode;
}

/**
 * Lays out the groups of a menu as a flat list separated by rules.
 *
 * The entries are direct children of the menu, with a separator between groups.
 * They are deliberately *not* wrapped in a grouping element: an entry inside
 * one would never be registered as a menu entry at all, so it could not be
 * reached by keyboard or found by an assistive technology. The component tests
 * hold that.
 *
 * A group's label is the menu's own label element, which the roving focus and
 * the typeahead pass over, and each entry of the group is described by it, so
 * the name of the group is read with the entry rather than only seen above it.
 * `idPrefix` keeps the labels of two menus on one page apart.
 */
export function menuGroups(
  groups: readonly MenuGroup[],
  idPrefix: string,
  parts: MenuGroupParts,
): ReactNode {
  return groups.flatMap((group, index) => {
    const labelId = group.label === undefined ? undefined : `${idPrefix}-${group.key}`;
    return [
      ...(index > 0 ? [parts.separator(`${group.key}-separator`)] : []),
      ...(group.label === undefined || labelId === undefined
        ? []
        : [parts.label(`${group.key}-label`, labelId, group.label)]),
      ...group.items.map((item) => parts.item(item, labelId)),
    ];
  });
}

/** The attribute a menu's content carries when its entries have a glyph column. */
export function glyphColumn(groups: readonly MenuGroup[]): { readonly 'data-ag-glyphs'?: '' } {
  return hasGlyphs(groups) ? { 'data-ag-glyphs': '' } : {};
}
