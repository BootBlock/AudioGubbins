/**
 * A menu opened by a right click or a long press: the context action of
 * REQ-UX-067.
 */

import { ContextMenu } from 'radix-ui';
import {
  useId,
  useImperativeHandle,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type Ref,
} from 'react';

import {
  glyphColumn,
  hasGlyphs,
  menuGroups,
  menuItemContent,
  menuItemProps,
  type MenuGroup,
} from './menu-entries.js';

/** Opens a context menu at a point of the page, for a long press its owner recognised. */
export interface ContextActionsOpener {
  readonly openAt: (clientX: number, clientY: number) => void;
}

/** What a context menu takes. */
export interface ContextMenuProps {
  /** What the menu belongs to. */
  readonly children: ReactNode;

  readonly groups: readonly MenuGroup[];
  readonly label: string;

  /**
   * Given where what the menu belongs to recognises a long press itself, as the
   * editor's surface does with its own delay and tolerance, and opens the menu
   * through this. The menu then leaves a finger's or a pen's press alone.
   */
  readonly opener?: Ref<ContextActionsOpener>;
}

/** Whether a pointer event, or a context menu event an engine reports as one, came from a finger or a pen. */
function byTouchOrPen(event: ReactPointerEvent | ReactMouseEvent): boolean {
  const kind: unknown = Reflect.get(event.nativeEvent, 'pointerType');
  return kind === 'touch' || kind === 'pen';
}

/**
 * What a context menu's trigger is given where its owner recognises a long
 * press itself: the handle `opener` is set to, which opens the menu at a point
 * as a right click there opens it, since that is where Radix reads the point it
 * places the menu at; and, with an opener, handlers that keep the menu's own
 * long press off a finger's or a pen's press, which it ignores once the press
 * is handled, and off the browser's own, which arrives as a context menu event.
 */
function useOwnersLongPress(opener: Ref<ContextActionsOpener> | undefined) {
  const trigger = useRef<HTMLElement | null>(null);
  useImperativeHandle(
    opener,
    () => ({
      openAt: (clientX, clientY) => {
        trigger.current?.dispatchEvent(
          new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX, clientY }),
        );
      },
    }),
    [],
  );
  const handled = (event: ReactPointerEvent | ReactMouseEvent): void => {
    if (byTouchOrPen(event)) event.preventDefault();
  };
  return {
    ref: (element: HTMLElement | null) => {
      trigger.current = element;
    },
    ...(opener === undefined ? {} : { onPointerDown: handled, onContextMenu: handled }),
  };
}

/**
 * A menu opened by a right click or a long press.
 *
 * Radix opens it on a long press as well as a right click, which is what
 * REQ-UX-067 asks for: long press is the touch equivalent of the context
 * action. Its long press opens after 700 milliseconds, and is given up at the
 * first movement a finger or a pen reports, which a pen held still reports as
 * its pressure changes; so where the owner recognises the long press and opens
 * the menu itself, through `opener`, one rule decides it.
 */
export function ContextActions({ children, groups, label, opener }: ContextMenuProps): ReactNode {
  const idPrefix = useId();
  const trigger = useOwnersLongPress(opener);
  const glyphs = hasGlyphs(groups);
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild {...trigger}>
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className="ag-menu ag-overlay"
          aria-label={label}
          {...glyphColumn(groups)}
        >
          {menuGroups(groups, idPrefix, {
            item: (item, describedBy) => (
              <ContextMenu.Item key={item.key} {...menuItemProps(item, describedBy)}>
                {menuItemContent(item, glyphs)}
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
