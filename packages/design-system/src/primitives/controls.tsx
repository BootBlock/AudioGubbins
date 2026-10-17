/**
 * Controls that hold a value: switches, tabs and toolbars; the slider is
 * `value-slider.tsx`, the select and the text field are under `fields/`.
 *
 * Each wraps a Radix primitive, which supplies the keyboard behaviour and the
 * ARIA roles, and adds what AudioGubbins needs on top: a value a screen reader
 * can read aloud in the unit the user is working in, and a touch target that
 * does not shrink with the density (REQ-UX-005, REQ-UX-067, REQ-UX-071).
 *
 * The unit matters. A slider that announces "0.7" where the user is thinking in
 * decibels is technically labelled and practically useless, so every numeric
 * control here takes a function that formats its own value.
 */

import { Switch, Tabs, Toolbar, Tooltip } from 'radix-ui';
import { useId, type ReactNode } from 'react';

import { Button, ButtonTone } from './button.js';
import { hintSurface } from './overlays/tooltips.js';

/** What a switch takes. */
export interface ToggleSwitchProps {
  readonly label: string;
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;

  /** A sentence explaining what turning it on does. */
  readonly description?: string;

  readonly disabled?: boolean;
}

/** A control for something that is on or off. */
export function ToggleSwitch({
  label,
  checked,
  onCheckedChange,
  description,
  disabled = false,
}: ToggleSwitchProps): ReactNode {
  const labelId = useId();
  const descriptionId = useId();

  return (
    <div className="ag-switch-field">
      <div className="ag-switch-text">
        <span className="ag-switch-label" id={labelId}>
          {label}
        </span>
        {description !== undefined && (
          <span className="ag-switch-description" id={descriptionId}>
            {description}
          </span>
        )}
      </div>
      <Switch.Root
        className="ag-switch ag-touch-target"
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-labelledby={labelId}
        {...(description === undefined ? {} : { 'aria-describedby': descriptionId })}
      >
        <Switch.Thumb className="ag-switch-thumb" />
      </Switch.Root>
    </div>
  );
}

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
 * reach. Use {@link ControlBarButton} for a button with a hint, rather than
 * wrapping one here.
 */
export function ControlBarItem({ children }: { readonly children: ReactNode }): ReactNode {
  return <Toolbar.Button asChild>{children}</Toolbar.Button>;
}

/** What a control-bar button takes. */
export interface ControlBarButtonProps {
  /** The visible text, and the button's accessible name. */
  readonly label: string;

  /** The hint shown on hover or focus. Without one, the button has no tooltip. */
  readonly hint?: string;

  /** The shortcut, shown after the hint (REQ-UX-066). */
  readonly shortcut?: string;

  readonly onPress: () => void;
}

/**
 * A button inside a {@link ControlBar}, with an optional hint.
 *
 * The toolbar item, the tooltip trigger and the button are composed onto one
 * element rather than nested, because each has to reach the real button: the
 * toolbar to give it the roving focus, the tooltip to open against it. Nesting
 * a finished hint inside a toolbar item loses both.
 */
export function ControlBarButton({
  label,
  hint,
  shortcut,
  onPress,
}: ControlBarButtonProps): ReactNode {
  const button = (
    <Button tone={ButtonTone.Quiet} compact onClick={onPress}>
      {label}
    </Button>
  );

  if (hint === undefined) return <Toolbar.Button asChild>{button}</Toolbar.Button>;

  return (
    <Tooltip.Root>
      <Toolbar.Button asChild>
        <Tooltip.Trigger asChild>{button}</Tooltip.Trigger>
      </Toolbar.Button>
      {hintSurface(hint, shortcut)}
    </Tooltip.Root>
  );
}

/** Text present for a screen reader and absent for everyone else. */
export function VisuallyHidden({ children }: { readonly children: ReactNode }): ReactNode {
  return <span className="ag-visually-hidden">{children}</span>;
}
