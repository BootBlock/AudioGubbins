/**
 * What the shell reads, from every store the application holds.
 *
 * The head of the component that draws the shell: nine subscriptions, and what
 * is derived from them. Apart from the component so that it stays within the
 * review trigger of 50 to 70 logical lines (REQ-EXEC-136.7): written inline,
 * they would take it past 280. The two effects that ride on what it reads, the
 * redraw when diagnostic mode ends and the contrast warning, are hooks of their
 * own, since each needs two inputs and neither is what the shell is showing.
 */

import { useMemo, useSyncExternalStore } from 'react';

import { commandId, shortcutOffered } from '@audiogubbins/commands';
import { resolveTheme } from '@audiogubbins/design-system';

import type { Application } from '../application.js';
import { logCategoriesFrom } from '../log-categories.js';
import { useContrastWarning } from './use-contrast-warning.js';
import { useRedrawAt } from './use-redraw-at.js';

/** Reads every store the shell draws from, and keeps the shell drawing it. */
export function useShellState(application: Application) {
  const { context, registry, logger, convention, appearance, storage } = application;

  const preferences = useSyncExternalStore(context.preferences.subscribe, context.preferences.get);
  const workspace = useSyncExternalStore(context.workspace.subscribe, context.workspace.get);
  const interaction = useSyncExternalStore(context.interaction.subscribe, context.interaction.get);
  const shortcuts = useSyncExternalStore(context.shortcuts.subscribe, context.shortcuts.get);
  const verbosity = useSyncExternalStore(context.verbosity.subscribe, context.verbosity.get);
  const keyboardLayout = useSyncExternalStore(
    context.keyboardLayout.subscribe,
    context.keyboardLayout.get,
  );
  const persistence = useSyncExternalStore(storage.subscribe, storage.get);
  const missingCapabilities = useSyncExternalStore(
    context.capabilities.subscribe,
    context.capabilities.missing,
  );

  // The theme the provider will resolve, read here because the dock is mounted
  // outside it and has to be given the same answer.
  const systemAppearance = useSyncExternalStore(appearance.subscribe, appearance.read);
  const resolvedTheme = useMemo(
    () => resolveTheme(preferences, systemAppearance),
    [preferences, systemAppearance],
  );

  // Diagnostic mode ends lazily, the next time the centre is asked, so the
  // shell redraws when it is due to end and asks.
  const diagnosticModeEndsAt = context.diagnostics.diagnosticModeEndsAt();
  useRedrawAt(diagnosticModeEndsAt, context.clock);

  useContrastWarning(resolvedTheme, logger);

  /** The subsystems writing to the log, so each can be given its own level. */
  const logCategories = logCategoriesFrom(
    Object.keys(verbosity.categoryOverrides),
    context.logs.snapshot().map((record) => record.category),
  );

  /** The palette's own shortcut, for the hint on its button. */
  const paletteShortcut = useMemo(
    () =>
      shortcutOffered(
        shortcuts.profile,
        commandId('view.command-palette'),
        convention,
        keyboardLayout,
      ),
    [convention, shortcuts, keyboardLayout],
  );

  /** Every command, for the shortcut editor. Fixed once the registry is built. */
  const editableCommands = useMemo(
    () =>
      registry
        .all()
        // A command only a gesture can supply the argument for is left out:
        // bound to a key, every press of it could only refuse.
        .filter((command) => command.discoverable !== false)
        .map((command) => ({ id: command.id, label: command.label })),
    [registry],
  );

  return {
    preferences,
    workspace,
    interaction,
    shortcuts,
    verbosity,
    keyboardLayout,
    persistence,
    missingCapabilities,
    resolvedTheme,
    diagnosticModeEndsAt,
    logCategories,
    paletteShortcut,
    editableCommands,
  };
}
