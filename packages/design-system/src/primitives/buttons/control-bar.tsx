/**
 * The toolbar: a group of related controls reached with one Tab stop and then
 * the arrow keys.
 *
 * Wraps Radix's toolbar, which supplies the roving focus and the role. Its
 * buttons sit two pixels apart as one group, and a separator splits one group
 * from the next (design language, section 10). A mode one of its buttons
 * toggles shows as that button's on state.
 */

import { Toolbar } from 'radix-ui';
import type { ReactNode } from 'react';

import type { IconName } from '../../icons/vocabulary.js';
import { Button, ButtonTone } from '../button.js';
import { IconButton } from './icon-button.js';

/** What a toolbar takes. */
export interface ControlBarProps {
  /** The accessible name, for example "Transport" or "Editing tools". */
  readonly label: string;

  readonly children: ReactNode;
}

/**
 * A row of controls reached with one Tab stop and then the arrow keys.
 *
 * Without the roving focus a toolbar of twelve buttons costs a keyboard user
 * twelve presses to pass, which is what makes long toolbars hostile.
 *
 * The controls inside must be {@link ControlBarItem}. An ordinary button placed
 * here keeps its own Tab stop, so the toolbar looks right and behaves like a
 * plain row of buttons; the component tests catch that.
 */
export function ControlBar({ label, children }: ControlBarProps): ReactNode {
  return (
    <Toolbar.Root className="ag-toolbar" aria-label={label}>
      {children}
    </Toolbar.Root>
  );
}

/**
 * One control inside a {@link ControlBar}.
 *
 * Wraps its child so the toolbar's roving focus reaches it. The child is
 * rendered as-is, so it is still an AudioGubbins Button with its own tone,
 * density and touch target.
 *
 * The child must be a component that passes the props and the ref it is given
 * down to a real element. A component that does not, such as a wrapper whose
 * own root is another component, silently drops them. The toolbar then holds an
 * item with no element behind it, and the first Tab into the toolbar throws
 * rather than moving focus, which takes the whole menu bar out of keyboard
 * reach. `Button` and `IconButton` pass both, their hints included.
 */
export function ControlBarItem({ children }: { readonly children: ReactNode }): ReactNode {
  return <Toolbar.Button asChild>{children}</Toolbar.Button>;
}

/** The line between two groups of a {@link ControlBar}. */
export function ControlBarSeparator(): ReactNode {
  return <Toolbar.Separator className="ag-toolbar-separator" />;
}

/** What a control-bar button takes. */
export interface ControlBarButtonProps {
  /**
   * The visible text, and the button's accessible name. With an icon, the name
   * alone, the glyph standing for it.
   */
  readonly label: string;

  /** The glyph, for a button that shows it in place of its label. */
  readonly icon?: IconName;

  /** The hint shown on hover or focus. Without one, the button has no tooltip. */
  readonly hint?: string;

  /** The shortcut, shown after the hint (REQ-UX-066). */
  readonly shortcut?: string;

  /**
   * Whether the mode the button toggles is on. Left out, the button runs an
   * action and has no on state.
   */
  readonly pressed?: boolean;

  /** Why the button cannot be used now, or `undefined` while it can (ADR-0013). */
  readonly unavailableReason?: string;

  readonly onPress: () => void;
}

/**
 * A button inside a {@link ControlBar}, with an optional hint.
 *
 * The toolbar item, the hint's trigger and the button are composed onto one
 * element rather than nested, because each has to reach the real button: the
 * toolbar to give it the roving focus, the hint to open against it. The button
 * carries its own hint for that reason.
 */
export function ControlBarButton({
  label,
  icon,
  hint,
  shortcut,
  pressed,
  unavailableReason,
  onPress,
}: ControlBarButtonProps): ReactNode {
  const optional = {
    ...(hint === undefined ? {} : { hint }),
    ...(shortcut === undefined ? {} : { shortcut }),
    ...(unavailableReason === undefined ? {} : { unavailableReason }),
  };
  return (
    <Toolbar.Button asChild>
      {icon === undefined ? (
        <Button
          {...optional}
          tone={ButtonTone.Quiet}
          compact
          {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
          onClick={onPress}
        >
          {label}
        </Button>
      ) : (
        <IconButton
          {...optional}
          icon={icon}
          label={label}
          compact
          {...(pressed === undefined ? {} : { pressed })}
          onClick={onPress}
        />
      )}
    </Toolbar.Button>
  );
}
