import { describe, expect, it, vi } from 'vitest';

import { KeyboardConvention, createCommandRegistry } from '@audiogubbins/commands';
import { SCHEMA_VERSIONS } from '@audiogubbins/version';

import { shellCommands } from '../commands/shell-commands.js';
import type { ShellContext } from '../commands/shell-context.js';
import { buildLayoutStore } from '../testing/layout-store.js';
import { projectWorld } from '../testing/project-context.js';
import { DESCRIPTORS, buildShellContext } from '../testing/shell-context.js';
import { shellMenus, type MenuSources } from './menus.js';

/**
 * The menu bar against the real command set.
 *
 * The builder refuses a menu entry naming a command that is not registered:
 * left out without a word, a renamed command would take its menu entry with it
 * and nothing would say so. This builds every menu this application ships
 * against every command it registers.
 */

/** What the menus need, built from the shell's real commands. */
function sources(
  registered = shellCommands(DESCRIPTORS),
  keyboard = buildLayoutStore().store,
  given?: ShellContext,
): MenuSources {
  const context =
    given ?? buildShellContext(undefined, KeyboardConvention.Windows, keyboard).context;
  const registry = createCommandRegistry<ShellContext>();
  for (const command of registered) registry.register(command);

  return {
    registry,
    context,
    profile: context.shortcuts.get().profile,
    convention: context.convention,
    layout: context.keyboardLayout.get(),
    descriptors: DESCRIPTORS,
    workspace: context.workspace.get(),
    run: () => undefined,
  };
}

describe('the menu bar', () => {
  it('names only commands the application registers', () => {
    const menus = shellMenus(sources());
    const entries = menus.flatMap((menu) => menu.groups.flatMap((group) => group.items));

    expect(menus.map((menu) => menu.label)).toEqual([
      'File',
      'Edit',
      'View',
      'Workspace',
      'Editor',
      'Help',
    ]);
    expect(entries).toHaveLength(138);
  });

  it('names the panel the arrangement entries act on', () => {
    // Opening the menu bar takes focus out of the dock, so "this panel" said
    // nothing about which panel would move.
    const given = sources();
    const layout = given.workspace.layout;
    const active = layout.groups
      .flatMap((group) => group.panels)
      .find((panel) => panel.id === layout.activePanelId);
    const title = active === undefined ? undefined : DESCRIPTORS.get(active.kind)?.title;

    const workspaceMenu = shellMenus(given).find((menu) => menu.label === 'Workspace');
    const arrangement = workspaceMenu?.groups.find((group) => group.key === 'arrangement');

    expect(title).toBeDefined();
    expect(arrangement?.label).toBe(`Arrange the ${title ?? ''} panel`);
  });

  it('writes each shortcut in the characters the keyboard types', () => {
    // On Dvorak the key at V types K and the key at R types P. Written at the
    // keys' US names, the palette's shortcut read Ctrl+V, Ctrl+R.
    const keyboard = buildLayoutStore().store;
    keyboard.adopt([
      ['KeyK', 't'],
      ['KeyV', 'k'],
      ['KeyR', 'p'],
    ]);
    const entries = shellMenus(sources(undefined, keyboard)).flatMap((menu) =>
      menu.groups.flatMap((group) => group.items),
    );

    expect(entries.find((one) => one.key === 'view.command-palette')?.shortcut).toBe(
      'Ctrl+K, Ctrl+P',
    );
  });

  it('offers no shortcut for an entry whose binding the browser takes', () => {
    // A binding made on another keyboard is kept rather than dropped, because
    // the layout becomes known as the user types. Shown beside a menu entry,
    // it taught a press that closes the browser tab.
    const keyboard = buildLayoutStore().store;
    const { context } = buildShellContext(undefined, KeyboardConvention.Windows, keyboard);
    context.shortcuts.imported(
      JSON.stringify({
        schemaVersion: SCHEMA_VERSIONS.shortcutProfile,
        displayName: 'From another keyboard',
        bindings: [{ command: 'view.command-palette', presses: ['C+KeyW'] }],
      }),
    );

    const entries = shellMenus(sources(undefined, keyboard, context)).flatMap((menu) =>
      menu.groups.flatMap((group) => group.items),
    );

    expect(entries.find((one) => one.key === 'view.command-palette')?.shortcut).toBeUndefined();
  });

  it('marks a built-in workspace in the list to switch to, as the settings do', () => {
    // Listed by name alone, a built-in workspace and one the user made read
    // alike, and only the settings said which ships.
    const given = sources();
    given.context.workspace.saveAs('Mine');
    const labels = shellMenus({ ...given, workspace: given.context.workspace.get() })
      .find((menu) => menu.label === 'Workspace')
      ?.groups.find((group) => group.key === 'workspaces')
      ?.items.map((item) => item.label);

    expect(labels).toContain('Editing (built in)');
    expect(labels).toContain('Mine');
    expect(labels).not.toContain('Editing');
  });

  it('refuses, naming it, a command that is not registered', () => {
    const withoutOne = shellCommands(DESCRIPTORS).filter(
      (command) => command.id !== 'view.command-palette',
    );

    expect(() => shellMenus(sources(withoutOne))).toThrow('"view.command-palette"');
  });
});

describe('the File and Edit menus', () => {
  it('opens the Projects dialogue at the section each entry names', async () => {
    const window = await projectWorld().window();
    const run = vi.fn();
    const file = shellMenus({ ...sources(undefined, undefined, window.context), run }).find(
      (menu) => menu.label === 'File',
    );

    const entries = file?.groups.flatMap((group) => group.items) ?? [];
    entries.find((one) => one.label === 'New project…')?.onSelect();
    entries.find((one) => one.label === 'Open project…')?.onSelect();
    expect(run.mock.calls).toEqual([
      ['file.projects', { section: 'new' }],
      ['file.projects', { section: 'open' }],
    ]);
    expect(entries.find((one) => one.key === 'file.close-project')?.unavailableReason).toBe(
      'No project is open.',
    );
  });

  it('names the change Undo and Redo would reverse and repeat', async () => {
    const window = await projectWorld().window();
    await window.runAndHear('file.create-project', { name: 'A' });
    await window.runAndHear('file.rename-project', { name: 'B' });

    const edit = () =>
      shellMenus(sources(undefined, undefined, window.context))
        .find((menu) => menu.label === 'Edit')
        ?.groups.flatMap((group) => group.items) ?? [];
    expect(
      edit()
        .map((one) => one.label)
        .slice(0, 2),
    ).toEqual(['Undo Rename project to “B”', 'Redo']);

    await window.runAndHear('edit.undo');
    expect(
      edit()
        .map((one) => one.label)
        .slice(0, 2),
    ).toEqual(['Undo', 'Redo Rename project to “B”']);
    expect(edit()[0]?.unavailableReason).toBe('There is nothing to undo.');
  });
});
