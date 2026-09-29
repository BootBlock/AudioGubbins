/**
 * Every action the shell can perform.
 *
 * REQ-EDIT-073 requires each of these to be reachable the same way from a menu,
 * a shortcut, the palette and a future macro, which is what registering them
 * here achieves. A menu item that called a store method directly would work and
 * would be invisible to the palette, unbindable to a shortcut, and absent from
 * any future automation.
 *
 * The commands are grouped by what they act on, one module each, because they
 * have nothing in common but the shape {@link shellCommand} gives them. Kept in
 * one file, they would put it past the cohesion threshold REQ-EXEC-136.7 sets,
 * and the split is along the seam the categories already describe.
 */

import { AVAILABLE, CommandCategory, unavailable, type Command } from '@audiogubbins/commands';
import type { PanelDescriptor, PanelKind } from '@audiogubbins/workspace';

import { audioCommands } from './audio-commands.js';
import { diagnosticCommands } from './diagnostic-commands.js';
import { shellCommand } from './shell-command.js';
import { shortcutCommands } from './shortcut-commands.js';
import type { ShellContext } from './shell-context.js';
import { viewCommands } from './view-commands.js';
import { panelCommands } from './panel-commands.js';
import { workspaceCommands } from './workspace-commands.js';

/**
 * The surfaces a user opens rather than the things they change.
 *
 * Shutting one is a command as well as opening it. Were one opened by a command
 * and closed by a write to the store, the palette could be opened from a macro,
 * a menu, the palette itself and a shortcut, and closed from nowhere but the
 * dialogue's own dismissal. ADR-0013 makes a shell action a command or nothing,
 * and a rule holds the interface to it.
 */
function surfaceCommands(): readonly Command<ShellContext>[] {
  return [
    shellCommand(
      'view.command-palette',
      'Show the command palette',
      CommandCategory.View,
      (context) => {
        context.interaction.setPaletteOpen(true);
      },
      {
        keywords: ['command', 'palette', 'search', 'run', 'find'],
        availability: (context) =>
          context.interaction.get().paletteOpen
            ? unavailable('The command palette is already open.')
            : AVAILABLE,
      },
    ),

    shellCommand(
      'view.close-command-palette',
      'Close the command palette',
      CommandCategory.View,
      (context) => {
        context.interaction.setPaletteOpen(false);
      },
      {
        keywords: ['command', 'palette', 'close', 'dismiss', 'hide'],
        availability: (context) =>
          context.interaction.get().paletteOpen
            ? AVAILABLE
            : unavailable('The command palette is not open.'),
      },
    ),

    shellCommand(
      'settings.open',
      'Settings',
      CommandCategory.Settings,
      (context) => {
        context.interaction.setSettingsOpen(true);
      },
      {
        keywords: ['settings', 'preferences', 'options', 'configure'],
        availability: (context) =>
          context.interaction.get().settingsOpen
            ? unavailable('The settings are already open.')
            : AVAILABLE,
      },
    ),

    shellCommand(
      'settings.close',
      'Close settings',
      CommandCategory.Settings,
      (context) => {
        context.interaction.setSettingsOpen(false);
      },
      {
        keywords: ['settings', 'preferences', 'close', 'dismiss', 'hide'],
        availability: (context) =>
          context.interaction.get().settingsOpen
            ? AVAILABLE
            : unavailable('Settings are not open.'),
      },
    ),
  ];
}

/**
 * Builds every shell command.
 *
 * The panel descriptors are passed rather than imported, because they are the
 * composition root's decision about what this build contains. A command module
 * that reached for them directly would be deciding it for itself.
 */
export function shellCommands(
  descriptors: ReadonlyMap<PanelKind, PanelDescriptor>,
): readonly Command<ShellContext>[] {
  return [
    ...viewCommands(),
    ...workspaceCommands(),
    ...panelCommands(descriptors),
    ...surfaceCommands(),
    ...shortcutCommands(),
    ...diagnosticCommands(),
    ...audioCommands(),
  ];
}
