/**
 * Surfaces that float above the workspace: dialogues, menus, popovers,
 * tooltips.
 *
 * All four share the hard parts: focus has to move into them and come back out
 * to where it started, Escape has to close them, a screen reader has to be told
 * what appeared, and the rest of the application has to be inert while a modal
 * one is open. Radix solves those, and AudioGubbins wraps it so that the
 * solution is applied consistently and so that no feature imports Radix
 * directly (REQ-UX-155, enforced by the architecture rules).
 *
 * The wrappers are deliberately narrower than Radix. Each exposes the props
 * AudioGubbins actually uses, which is what keeps the design system a design
 * system rather than a re-export.
 */

import { Dialog, DropdownMenu, ContextMenu, Popover, Tooltip } from 'radix-ui';
import { useId, useRef, type ReactNode } from 'react';

import { DialogueNotice, useDialogueOpen } from './announcement.js';
import { useFocusReturn } from './focus-return.js';

/** What a dialogue takes. */
export interface ModalDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;

  /** The dialogue's heading. Also its accessible name. */
  readonly title: string;

  /**
   * A sentence describing what the dialogue is for.
   *
   * Required rather than optional: a screen-reader user meets the dialogue with
   * no surrounding context, and a title alone often does not say what will
   * happen. Radix warns when it is missing; making it required means the
   * warning never has to appear.
   */
  readonly description: string;

  readonly children: ReactNode;

  /** The buttons along the bottom. */
  readonly actions?: ReactNode;
}

/**
 * A modal dialogue: its title, then what it holds, which scrolls, then a
 * footer that does not.
 *
 * A notice raised while it is open is shown in the footer, above its actions,
 * and not over the page: see `NoticeProvider`. The footer stays in sight
 * because the refusal in it has to be: above the actions of a dialogue that
 * scrolled as a whole, it would be out of sight whenever the reader pressed a
 * control near the top. Only the part between scrolls, so no control can be
 * scrolled under the footer, and the footer has no cap, so it never cuts the
 * refusal. Where the three are taller than the page allows, the dialogue
 * scrolls as a whole, and the reader can scroll to the part of a refusal the
 * control they are on leaves out of sight.
 */
export function ModalDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  actions,
}: ModalDialogProps): ReactNode {
  const content = useRef<HTMLDivElement | null>(null);

  const restoreFocus = useFocusReturn(content);

  const dialogue = useId();
  useDialogueOpen(dialogue, open);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ag-dialog-overlay" />
        <Dialog.Content
          ref={content}
          className="ag-dialog"
          onEscapeKeyDown={(event) => {
            // A control that records key presses owns Escape while it listens.
            // The dialogue listens in the capture phase, so without this it
            // would close before a shortcut recorder saw the key it uses to
            // stop recording, and the recording would be lost with the
            // dialogue.
            if (
              event.target instanceof Element &&
              event.target.closest('[data-ag-captures-escape]') !== null
            ) {
              event.preventDefault();
            }
          }}
          onCloseAutoFocus={(event) => {
            // Left to Radix when nothing could be restored, rather than
            // pretending otherwise. That happens when the dialogue was opened
            // before the user had focused anything, where the body is where
            // focus genuinely was.
            if (restoreFocus()) event.preventDefault();
          }}
        >
          <Dialog.Title className="ag-dialog-title">{title}</Dialog.Title>
          <div className="ag-dialog-scroll">
            <Dialog.Description className="ag-dialog-description">{description}</Dialog.Description>
            <div className="ag-dialog-body">{children}</div>
          </div>
          <div className="ag-dialog-footer">
            <DialogueNotice dialogue={dialogue} />
            {actions !== undefined && <div className="ag-dialog-actions">{actions}</div>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** One entry in a menu. */
export interface MenuItemDescriptor {
  /** Stable key, usually the identifier of the command the entry runs. */
  readonly key: string;

  readonly label: string;

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
 * The visible content of one menu entry.
 *
 * Shared because the label and the shortcut sit the same way in both menu
 * kinds. The entry element itself is not shared: a dropdown entry and a context
 * entry are different Radix components with different types, and forcing one to
 * stand in for the other would need an assertion that the compiler is right to
 * refuse.
 */
export function menuItemContent(item: MenuItemDescriptor): ReactNode {
  return (
    <>
      <span className="ag-menu-item-label">{item.label}</span>
      {item.shortcut !== undefined && (
        <span className="ag-menu-item-shortcut">{item.shortcut}</span>
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
    className: 'ag-menu-item ag-touch-sized',
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
  return menuGroups(groups, idPrefix, {
    item: (item, describedBy) => (
      <DropdownMenu.Item key={item.key} {...menuItemProps(item, describedBy)}>
        {menuItemContent(item)}
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
        <DropdownMenu.Content className="ag-menu" aria-label={label} sideOffset={4}>
          {menuGroupsContent(groups, idPrefix)}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** What a context menu takes. */
export interface ContextMenuProps {
  /** What the menu belongs to. */
  readonly children: ReactNode;

  readonly groups: readonly MenuGroup[];
  readonly label: string;
}

/**
 * A menu opened by a right click or a long press.
 *
 * Radix opens it on a long press as well as a right click, which is what
 * REQ-UX-067 asks for: long press is the touch equivalent of the context
 * action.
 */
export function ContextActions({ children, groups, label }: ContextMenuProps): ReactNode {
  const idPrefix = useId();
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="ag-menu" aria-label={label}>
          {menuGroups(groups, idPrefix, {
            item: (item, describedBy) => (
              <ContextMenu.Item key={item.key} {...menuItemProps(item, describedBy)}>
                {menuItemContent(item)}
              </ContextMenu.Item>
            ),
            separator: (key) => <ContextMenu.Separator key={key} className="ag-menu-separator" />,
            label: (key, id, text) => (
              <ContextMenu.Label key={key} id={id} className="ag-menu-label">
                {text}
              </ContextMenu.Label>
            ),
          })}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/** What a popover takes. */
export interface InfoPopoverProps {
  readonly trigger: ReactNode;
  readonly label: string;
  readonly children: ReactNode;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}

/** A non-modal surface holding controls or an explanation. */
export function InfoPopover({
  trigger,
  label,
  children,
  open,
  onOpenChange,
}: InfoPopoverProps): ReactNode {
  // Spread rather than pass, because Radix distinguishes an absent `open` prop
  // (it manages its own state) from one set to `undefined`. Under
  // exactOptionalPropertyTypes those are different things, which is the point.
  const controlled = {
    ...(open === undefined ? {} : { open }),
    ...(onOpenChange === undefined ? {} : { onOpenChange }),
  };

  return (
    <Popover.Root {...controlled}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="ag-popover" aria-label={label} sideOffset={6}>
          {children}
          <Popover.Arrow className="ag-popover-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * The floating part of a hint, for a control that composes its own trigger.
 *
 * Every control that shows a hint is in that position: a toolbar item's roving
 * focus and the tooltip's trigger have to merge onto one button, so the trigger
 * cannot wrap a finished component. No component serves the other case, because
 * no control is in it, and one kept for a caller that cannot exist would be
 * code nothing runs.
 */
export function hintSurface(text: string, shortcut?: string): ReactNode {
  return (
    <Tooltip.Portal>
      <Tooltip.Content className="ag-tooltip" sideOffset={6}>
        {text}
        {shortcut !== undefined && <span className="ag-tooltip-shortcut">{shortcut}</span>}
        <Tooltip.Arrow className="ag-tooltip-arrow" />
      </Tooltip.Content>
    </Tooltip.Portal>
  );
}

/**
 * Enables tooltips for everything inside.
 *
 * One provider per application, so that moving between controls shows the
 * second hint immediately rather than waiting through the opening delay again.
 */
export function HintProvider({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <Tooltip.Provider delayDuration={500} skipDelayDuration={250}>
      {children}
    </Tooltip.Provider>
  );
}
