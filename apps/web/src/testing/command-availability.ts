/**
 * The shell's own commands on a bus, and what they say of their availability,
 * for a test of a section that reads it as the menus do.
 */

import {
  commandId,
  createCommandBus,
  createCommandRegistry,
  type CommandBus,
} from '@audiogubbins/commands';
import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';

import { shellCommands } from '../commands/shell-commands.js';
import type { ShellContext } from '../commands/shell-context.js';
import { DESCRIPTORS } from './shell-context.js';

/** The shell's own commands, on a bus. */
export function busOfShellCommands(): CommandBus<ShellContext> {
  const registry = createCommandRegistry<ShellContext>();
  for (const command of shellCommands(DESCRIPTORS)) registry.register(command);
  return createCommandBus(
    registry,
    createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('commands'),
  );
}

/** Why a command cannot run in `context`, or `undefined`, as the menus read it. */
export function reasonsIn(context: ShellContext): (id: string) => string | undefined {
  const bus = busOfShellCommands();
  return (id) => {
    const availability = bus.availability(context, commandId(id));
    return availability.available ? undefined : availability.reason;
  };
}
