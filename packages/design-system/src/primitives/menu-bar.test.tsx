import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

import { renderThemed } from '../testing/render-themed.js';
import { Button } from './button.js';
import { MenuBar, MenuBarMenu } from './menu-bar.js';
import type { MenuGroup } from './overlays/menu-entries.js';

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
