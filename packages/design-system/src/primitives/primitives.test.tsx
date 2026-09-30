import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';

import { DEFAULT_THEME_PREFERENCES, UNKNOWN_SYSTEM_APPEARANCE } from '../tokens/preferences.js';
import { ThemeProvider, fixedSystemAppearance } from '../theme/theme-provider.js';
import { Button } from './button.js';
import { NoticeProvider } from './announcement.js';
import { HintProvider, InfoPopover, Menu, ModalDialog, type MenuGroup } from './overlays.js';
import { MenuBar, MenuBarMenu } from './menu-bar.js';
import {
  ControlBar,
  ControlBarButton,
  ControlBarItem,
  OptionSelect,
  TabSet,
  TextField,
  ToggleSwitch,
  ValueSlider,
} from './controls.js';

/**
 * Renders inside a theme and the notices, as every AudioGubbins component is.
 * A dialogue shows a notice raised while it is open, so it needs the notices.
 */
function renderThemed(ui: ReactNode) {
  return render(
    <ThemeProvider
      preferences={DEFAULT_THEME_PREFERENCES}
      system={fixedSystemAppearance(UNKNOWN_SYSTEM_APPEARANCE)}
    >
      <HintProvider>
        <NoticeProvider notice={undefined}>{ui}</NoticeProvider>
      </HintProvider>
    </ThemeProvider>,
  );
}

describe('Button', () => {
  it('is reachable and pressable by name', async () => {
    const onClick = vi.fn();
    renderThemed(<Button onClick={onClick}>Reset layout</Button>);

    await userEvent.click(screen.getByRole('button', { name: 'Reset layout' }));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it('activates from the keyboard', async () => {
    const onClick = vi.fn();
    renderThemed(<Button onClick={onClick}>Reset layout</Button>);

    await userEvent.tab();
    await userEvent.keyboard('{Enter}');

    expect(onClick).toHaveBeenCalledOnce();
  });

  it('names itself for a screen reader when it shows only an icon', () => {
    renderThemed(<Button iconOnly label="Play" />);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('does not submit the form it happens to sit in', () => {
    // A toolbar button that submits its surrounding form is a defect that only
    // appears once the form exists, so the type is explicit rather than
    // default.
    renderThemed(<Button>Zoom in</Button>);
    expect(screen.getByRole('button', { name: 'Zoom in' })).toHaveAttribute('type', 'button');
  });

  it('is not pressable while disabled', async () => {
    const onClick = vi.fn();
    renderThemed(
      <Button onClick={onClick} disabled>
        Delete
      </Button>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('ModalDialog', () => {
  const dialog = (onOpenChange = vi.fn()): ReactNode => (
    <ModalDialog
      open
      onOpenChange={onOpenChange}
      title="Reset the workspace"
      description="This returns every panel to its built-in position."
      actions={<Button tone="primary">Reset</Button>}
    >
      <p>The project is not affected.</p>
    </ModalDialog>
  );

  it('announces itself with its title and its description', () => {
    // The description was drawn but not tied to the dialogue, so it was read
    // only by someone who went looking for it. A screen-reader user meets a
    // dialogue with no surrounding context, and the palette's description is
    // the only statement of how to drive it.
    renderThemed(dialog());

    const found = screen.getByRole('dialog', { name: 'Reset the workspace' });
    expect(found).toBeInTheDocument();

    const describedBy = found.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    const description = document.getElementById(describedBy ?? '');
    expect(description?.textContent).toBe('This returns every panel to its built-in position.');
  });

  it('says it is modal, which is what keeps the shortcuts off the page behind it', () => {
    // Radix makes the page behind inert and did not say so: the shortcut
    // listener, which reads this, ran the editor's keys behind the settings.
    renderThemed(dialog());

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });

  it('moves focus into itself when it opens', () => {
    renderThemed(dialog());
    expect(screen.getByRole('dialog')).toContainElement(
      document.activeElement as HTMLElement | null,
    );
  });

  it('closes on Escape', async () => {
    const onOpenChange = vi.fn();
    renderThemed(dialog(onOpenChange));

    await userEvent.keyboard('{Escape}');

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('puts focus back where it was, even though nothing in the page opened it', async () => {
    // Every AudioGubbins dialogue is opened by a command, so none of them has a
    // trigger to return focus to. Without this the focus would fall to the
    // document body when the dialogue closed, which drops a keyboard user out
    // of the application.
    function Host(): ReactNode {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button
            onClick={() => {
              setOpen(true);
            }}
          >
            Somewhere else
          </Button>
          <ModalDialog
            open={open}
            onOpenChange={setOpen}
            title="Settings"
            description="Everything about how AudioGubbins looks and behaves."
          >
            <p>Nothing to change yet.</p>
          </ModalDialog>
        </>
      );
    }

    renderThemed(<Host />);

    const elsewhere = screen.getByRole('button', { name: 'Somewhere else' });
    elsewhere.focus();

    // Opened from the keyboard, so no pointer press moves the focus for us.
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');

    await waitFor(() => {
      expect(elsewhere).toHaveFocus();
    });
  });

  it('keeps Tab inside itself while it is open', async () => {
    renderThemed(dialog());

    for (let press = 0; press < 6; press += 1) {
      await userEvent.tab();
      expect(screen.getByRole('dialog')).toContainElement(
        document.activeElement as HTMLElement | null,
      );
    }
  });
});

/**
 * Menus are opened from the keyboard in these tests.
 *
 * Not a convenience: under jsdom, only the first `click` on a menu trigger in a
 * file opens anything. The trigger reports `aria-expanded="false"` immediately
 * afterwards in every later test, whatever the cleanup does, because the menu
 * library keeps module-level layer state that unmounting does not unwind. The
 * keyboard path is unaffected and was verified across five consecutive tests.
 *
 * The pointer path is covered where it can be tested honestly: the end-to-end
 * suite drives a real browser, where the artefact does not exist.
 */
async function openMenu(): Promise<void> {
  screen.getByRole('button', { name: 'Workspace' }).focus();
  await userEvent.keyboard('{Enter}');
}

describe('Menu', () => {
  const groups: readonly MenuGroup[] = [
    {
      key: 'layout',
      items: [
        { key: 'save', label: 'Save layout', shortcut: 'Ctrl+Shift+S', onSelect: vi.fn() },
        { key: 'reset', label: 'Reset layout', onSelect: vi.fn() },
      ],
    },
    {
      key: 'delete',
      items: [
        {
          key: 'delete',
          label: 'Delete layout',
          unavailableReason: 'A built-in layout cannot be deleted.',
          onSelect: vi.fn(),
        },
      ],
    },
  ];

  it('moves through the entries with the arrow keys', async () => {
    renderThemed(<Menu trigger={<Button>Workspace</Button>} groups={groups} label="Workspace" />);

    await openMenu();

    // Opening from the keyboard lands on the first entry, so the user is
    // already somewhere rather than having to press down to enter the menu.
    expect(await screen.findByRole('menuitem', { name: /Save layout/ })).toHaveFocus();

    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Reset layout' })).toHaveFocus();

    // The next entry is unavailable, and the arrow keys land on it all the
    // same, so its reason is read to a keyboard or screen-reader user. The
    // arrow keys passed over it, and only a pointer user could learn why it
    // could not be chosen, or what it said was already in force.
    await userEvent.keyboard('{ArrowDown}');
    const unavailable = screen.getByRole('menuitem', { name: /Delete layout/ });
    expect(unavailable).toHaveFocus();
    expect(unavailable).toHaveAccessibleName(/A built-in layout cannot be deleted\./);
  });

  it('reaches an unavailable entry by typing the start of its name', async () => {
    // The typeahead passed over an entry marked disabled as the arrow keys did,
    // so typing its name found nothing.
    renderThemed(<Menu trigger={<Button>Workspace</Button>} groups={groups} label="Workspace" />);

    await openMenu();
    expect(await screen.findByRole('menuitem', { name: /Save layout/ })).toHaveFocus();
    await userEvent.keyboard('d');

    expect(screen.getByRole('menuitem', { name: /Delete layout/ })).toHaveFocus();
  });

  it('runs nothing when an unavailable entry is chosen, and stays open', async () => {
    const onSelect = vi.fn();
    const one: readonly MenuGroup[] = [
      {
        key: 'g',
        items: [
          { key: 'delete', label: 'Delete layout', unavailableReason: 'Built in.', onSelect },
        ],
      },
    ];
    renderThemed(<Menu trigger={<Button>Workspace</Button>} groups={one} label="Workspace" />);

    await openMenu();
    expect(await screen.findByRole('menuitem', { name: /Delete layout/ })).toHaveFocus();
    await userEvent.keyboard('{Enter}');

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('menu', { name: 'Workspace' })).toBeInTheDocument();
  });

  it('runs the entry that was chosen', async () => {
    const onSelect = vi.fn();
    const single: readonly MenuGroup[] = [
      { key: 'g', items: [{ key: 'reset', label: 'Reset layout', onSelect }] },
    ];
    renderThemed(<Menu trigger={<Button>Workspace</Button>} groups={single} label="Workspace" />);

    await openMenu();
    await userEvent.keyboard('{ArrowDown}{Enter}');

    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('shows the shortcut beside an entry, and says in text why an unavailable one cannot be chosen, marked disabled rather than hidden', async () => {
    // Read from one opening, since each is only what the open menu shows.
    renderThemed(<Menu trigger={<Button>Workspace</Button>} groups={groups} label="Workspace" />);

    await openMenu();

    // The reason used to be carried only by `aria-description`, which Gecko and
    // WebKit do not implement, on an element the roving focus skips. Text is
    // part of the entry's accessible name, so every assistive technology reads
    // it and every user can see it.
    const entry = await screen.findByRole('menuitem', { name: /Delete layout/ });
    expect(entry).toHaveTextContent('A built-in layout cannot be deleted.');
    expect(entry).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Ctrl+Shift+S')).toBeInTheDocument();
  });
});

describe('InfoPopover', () => {
  /*
   * The popover primitive WU-01.B requires. Nothing in this phase opens one, so
   * nothing but these tests exercises it.
   */
  it('opens from its trigger as a named, non-modal surface', async () => {
    renderThemed(
      <InfoPopover trigger={<Button>About this capability</Button>} label="Shared memory">
        <p>Needs cross-origin isolation.</p>
      </InfoPopover>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'About this capability' }));

    const surface = await screen.findByRole('dialog', { name: 'Shared memory' });
    expect(surface).toHaveTextContent('Needs cross-origin isolation.');
    expect(surface).not.toHaveAttribute('aria-modal', 'true');
  });

  it('closes on Escape and gives focus back to its trigger', async () => {
    renderThemed(
      <InfoPopover trigger={<Button>About this capability</Button>} label="Shared memory">
        <p>Needs cross-origin isolation.</p>
      </InfoPopover>,
    );
    const trigger = screen.getByRole('button', { name: 'About this capability' });

    await userEvent.click(trigger);
    await screen.findByRole('dialog', { name: 'Shared memory' });
    await userEvent.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Shared memory' })).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();
  });

  it('follows a caller that controls whether it is open', () => {
    const { rerender } = renderThemed(
      <InfoPopover
        trigger={<Button>About this capability</Button>}
        label="Shared memory"
        open={false}
      >
        <p>Needs cross-origin isolation.</p>
      </InfoPopover>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(
      <ThemeProvider
        preferences={DEFAULT_THEME_PREFERENCES}
        system={fixedSystemAppearance(UNKNOWN_SYSTEM_APPEARANCE)}
      >
        <HintProvider>
          <InfoPopover trigger={<Button>About this capability</Button>} label="Shared memory" open>
            <p>Needs cross-origin isolation.</p>
          </InfoPopover>
        </HintProvider>
      </ThemeProvider>,
    );
    expect(screen.getByRole('dialog', { name: 'Shared memory' })).toBeInTheDocument();
  });
});

describe('ValueSlider', () => {
  it('announces its value in the unit the user is working in', () => {
    // A bare number is useless on a logarithmic control: the user is thinking
    // in decibels, not in the position of a thumb.
    renderThemed(
      <ValueSlider
        label="Gain"
        value={-6}
        minimum={-60}
        maximum={12}
        step={0.1}
        onValueChange={vi.fn()}
        describeValue={(value) => `${value.toFixed(1)} decibels`}
        displayValue="-6.0 dB"
      />,
    );

    expect(screen.getByRole('slider', { name: 'Gain' })).toHaveAttribute(
      'aria-valuetext',
      '-6.0 decibels',
    );
  });

  it('changes by one step from the keyboard', async () => {
    const onValueChange = vi.fn();
    renderThemed(
      <ValueSlider
        label="Gain"
        value={0}
        minimum={-60}
        maximum={12}
        step={1}
        onValueChange={onValueChange}
        describeValue={(value) => `${String(value)} decibels`}
      />,
    );

    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}');

    expect(onValueChange).toHaveBeenCalledWith(1);
  });

  it('reports its range, so a screen reader can say where the value sits', () => {
    renderThemed(
      <ValueSlider
        label="Gain"
        value={0}
        minimum={-60}
        maximum={12}
        step={1}
        onValueChange={vi.fn()}
        describeValue={String}
      />,
    );

    const slider = screen.getByRole('slider', { name: 'Gain' });
    expect(slider).toHaveAttribute('aria-valuemin', '-60');
    expect(slider).toHaveAttribute('aria-valuemax', '12');
  });
});

describe('TextField', () => {
  it('points at something outside itself as well as at its own description', () => {
    // The export dialogue's note preview is drawn below the field and the
    // field's description named it: told to look below, a reader who could not
    // see the page had no way there.
    render(
      <>
        <TextField
          label="What happened?"
          description="Optional."
          describedBy="ag-preview"
          value=""
          onValueChange={() => undefined}
        />
        <p id="ag-preview">Your note will be carried as: something.</p>
      </>,
    );

    const field = screen.getByRole('textbox', { name: 'What happened?' });
    expect(field).toHaveAccessibleDescription('Optional. Your note will be carried as: something.');
  });

  it('stops the reader at the bound what reads the value has', () => {
    // Declared on the field rather than cut afterwards, so the reader is
    // stopped at the bound instead of losing words they have written. Every
    // redaction rule reads the note this is for, on the main thread, as they
    // type.
    render(
      <TextField
        label="What happened?"
        maxLength={4_000}
        value=""
        onValueChange={() => undefined}
      />,
    );

    expect(screen.getByRole('textbox', { name: 'What happened?' })).toHaveAttribute(
      'maxlength',
      '4000',
    );
  });
});

describe('ToggleSwitch', () => {
  it('is reachable by its label and reports its state', () => {
    renderThemed(<ToggleSwitch label="Diagnostic mode" checked onCheckedChange={vi.fn()} />);

    expect(screen.getByRole('switch', { name: 'Diagnostic mode' })).toBeChecked();
  });

  it('toggles from the keyboard', async () => {
    const onCheckedChange = vi.fn();
    renderThemed(
      <ToggleSwitch label="Diagnostic mode" checked={false} onCheckedChange={onCheckedChange} />,
    );

    await userEvent.tab();
    await userEvent.keyboard(' ');

    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('associates its description with the control', () => {
    renderThemed(
      <ToggleSwitch
        label="Diagnostic mode"
        description="Collects more detail for a limited period."
        checked={false}
        onCheckedChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('switch', { name: 'Diagnostic mode' })).toHaveAccessibleDescription(
      'Collects more detail for a limited period.',
    );
  });
});

describe('OptionSelect', () => {
  it('is reachable by its label and shows the current value', () => {
    renderThemed(
      <OptionSelect
        label="Accent colour"
        value="teal"
        options={[
          { value: 'blue', label: 'Blue' },
          { value: 'teal', label: 'Teal' },
        ]}
        onValueChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('combobox', { name: 'Accent colour' })).toHaveTextContent('Teal');
  });

  it('chooses nothing from a letter typed at it while it is shut', async () => {
    // Every one of these runs a command as it changes, and a command is run
    // deliberately. Asked to press letter keys so the keyboard layout could be
    // learned, a user with focus here switched their shortcut profile instead.
    const chosen = vi.fn();
    renderThemed(
      <OptionSelect
        label="Shortcut profile"
        value="default"
        options={[
          { value: 'default', label: 'AudioGubbins default' },
          { value: 'mine', label: 'My shortcuts' },
        ]}
        onValueChange={chosen}
      />,
    );

    const trigger = screen.getByRole('combobox', { name: 'Shortcut profile' });
    trigger.focus();
    await userEvent.keyboard('m');

    expect(chosen).not.toHaveBeenCalled();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('still opens from the keyboard, so the list is reachable', async () => {
    renderThemed(
      <OptionSelect
        label="Shortcut profile"
        value="default"
        options={[
          { value: 'default', label: 'AudioGubbins default' },
          { value: 'mine', label: 'My shortcuts' },
        ]}
        onValueChange={vi.fn()}
      />,
    );

    const trigger = screen.getByRole('combobox', { name: 'Shortcut profile' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('TabSet', () => {
  it('names its tab list and shows only the selected panel', () => {
    renderThemed(
      <TabSet
        label="Settings sections"
        value="appearance"
        onValueChange={vi.fn()}
        tabs={[
          { value: 'appearance', label: 'Appearance', content: <p>Appearance settings</p> },
          { value: 'shortcuts', label: 'Shortcuts', content: <p>Shortcut settings</p> },
        ]}
      />,
    );

    expect(screen.getByRole('tablist', { name: 'Settings sections' })).toBeInTheDocument();
    expect(screen.getByText('Appearance settings')).toBeInTheDocument();
    expect(screen.queryByText('Shortcut settings')).not.toBeInTheDocument();
  });

  it('moves between tabs with the arrow keys', async () => {
    const onValueChange = vi.fn();
    renderThemed(
      <TabSet
        label="Settings sections"
        value="appearance"
        onValueChange={onValueChange}
        tabs={[
          { value: 'appearance', label: 'Appearance', content: <p>A</p> },
          { value: 'shortcuts', label: 'Shortcuts', content: <p>B</p> },
        ]}
      />,
    );

    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}');

    expect(onValueChange).toHaveBeenCalledWith('shortcuts');
  });
});

describe('ControlBar', () => {
  it('names itself, so a screen reader can say which toolbar this is', () => {
    renderThemed(
      <ControlBar label="Transport">
        <Button>Play</Button>
      </ControlBar>,
    );

    expect(screen.getByRole('toolbar', { name: 'Transport' })).toBeInTheDocument();
  });

  it('costs a keyboard user one Tab stop, not one per button', async () => {
    renderThemed(
      <>
        <ControlBar label="Transport">
          <ControlBarItem>
            <Button>Play</Button>
          </ControlBarItem>
          <ControlBarItem>
            <Button>Stop</Button>
          </ControlBarItem>
          <ControlBarItem>
            <Button>Record</Button>
          </ControlBarItem>
        </ControlBar>
        <Button>After the toolbar</Button>
      </>,
    );

    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Play' })).toHaveFocus();

    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'After the toolbar' })).toHaveFocus();
  });

  it('moves between its buttons with the arrow keys', async () => {
    renderThemed(
      <ControlBar label="Transport">
        <ControlBarItem>
          <Button>Play</Button>
        </ControlBarItem>
        <ControlBarItem>
          <Button>Stop</Button>
        </ControlBarItem>
      </ControlBar>,
    );

    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}');

    expect(screen.getByRole('button', { name: 'Stop' })).toHaveFocus();
  });

  it('keeps a hinted button reachable, so one tooltip does not cost the toolbar its keyboard access', async () => {
    // A hint used to be wrapped around a toolbar item, which dropped the props
    // and the ref the toolbar gives its items. The toolbar then held an item
    // with no element behind it, and the first Tab threw instead of moving
    // focus, taking every button in the toolbar out of keyboard reach.
    renderThemed(
      <ControlBar label="Transport">
        <ControlBarButton label="Play" hint="Start playback" shortcut="Space" onPress={vi.fn()} />
        <ControlBarItem>
          <Button>Stop</Button>
        </ControlBarItem>
      </ControlBar>,
    );

    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Play' })).toHaveFocus();

    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'Stop' })).toHaveFocus();
  });

  it('runs a hinted button when it is pressed', async () => {
    const onPress = vi.fn();
    renderThemed(
      <ControlBar label="Transport">
        <ControlBarButton label="Play" hint="Start playback" onPress={onPress} />
      </ControlBar>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Play' }));

    expect(onPress).toHaveBeenCalledOnce();
  });
});

describe('MenuBar', () => {
  const groups = (onSelect = vi.fn()): readonly MenuGroup[] => [
    {
      key: 'theme',
      items: [
        { key: 'dark', label: 'Use the dark theme', onSelect },
        { key: 'light', label: 'Use the light theme', shortcut: 'Ctrl+K Ctrl+B', onSelect },
      ],
    },
    { key: 'layout', items: [{ key: 'reset', label: 'Reset layout', onSelect }] },
  ];

  const bar = (onSelect = vi.fn()): ReactNode => (
    <MenuBar label="Main menu">
      <MenuBarMenu label="View" groups={groups(onSelect)} />
      <MenuBarMenu label="Workspace" groups={groups(onSelect)} />
    </MenuBar>
  );

  it('is a menu bar rather than a row of buttons', () => {
    renderThemed(bar());
    expect(screen.getByRole('menubar', { name: 'Main menu' })).toBeInTheDocument();
  });

  it('costs a keyboard user one Tab stop for the whole bar', async () => {
    renderThemed(
      <>
        {bar()}
        <Button>After the menu bar</Button>
      </>,
    );

    await userEvent.tab();
    expect(screen.getByRole('menuitem', { name: 'View' })).toHaveFocus();

    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'After the menu bar' })).toHaveFocus();
  });

  it('moves between its menus with the arrow keys', async () => {
    renderThemed(bar());

    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}');

    expect(screen.getByRole('menuitem', { name: 'Workspace' })).toHaveFocus();
  });

  it('opens a menu from the keyboard, shows the shortcut beside an entry, and runs what was chosen', async () => {
    const onSelect = vi.fn();
    renderThemed(bar(onSelect));

    await userEvent.tab();
    await userEvent.keyboard('{Enter}');

    expect(await screen.findByRole('menuitem', { name: 'Use the dark theme' })).toHaveFocus();
    expect(screen.getByText('Ctrl+K Ctrl+B')).toBeInTheDocument();

    await userEvent.keyboard('{ArrowDown}{Enter}');

    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('names a group at its head, reads the name with each entry, and gives it no focus', async () => {
    // A menu of bare names, "Editing" beside "Editor", said nothing about what
    // choosing one would do.
    renderThemed(
      <MenuBar label="Main menu">
        <MenuBarMenu
          label="Workspace"
          groups={[
            {
              key: 'workspaces',
              label: 'Switch to a workspace',
              items: [
                { key: 'editing', label: 'Editing', onSelect: vi.fn() },
                { key: 'recording', label: 'Recording', onSelect: vi.fn() },
              ],
            },
          ]}
        />
      </MenuBar>,
    );

    await userEvent.tab();
    await userEvent.keyboard('{Enter}');

    const editing = await screen.findByRole('menuitem', { name: 'Editing' });
    expect(editing).toHaveFocus();
    expect(editing).toHaveAccessibleDescription('Switch to a workspace');
    expect(screen.getByRole('menuitem', { name: 'Recording' })).toHaveAccessibleDescription(
      'Switch to a workspace',
    );

    // The label is shown and is not an entry: down and back up again lands on
    // the first entry, not on the label above it.
    expect(screen.getByText('Switch to a workspace')).not.toHaveAttribute('role', 'menuitem');
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Recording' })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    expect(editing).toHaveFocus();
  });
});
