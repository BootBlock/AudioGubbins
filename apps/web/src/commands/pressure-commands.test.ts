/**
 * The pressure choice from the keyboard and the palette: pressure turned on
 * and off, and the fixed strength set and stepped within its control, each a
 * preference change kept with the person's preferences.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  commandId,
  createCommandBus,
  createCommandRegistry,
  type CommandBus,
  type CommandInvocation,
} from '@audiogubbins/commands';
import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import { FIXED_STRENGTH_RANGE } from '@audiogubbins/input';

import { PREFERENCES_KEY } from '../state/preferences-store.js';
import { ephemeralStorage } from '../testing/ephemeral-storage.js';
import { DESCRIPTORS, buildShellContext } from '../testing/shell-context.js';
import { pressureCommands } from './pressure-commands.js';
import { shellCommands } from './shell-commands.js';
import type { ShellContext } from './shell-context.js';

let context: ShellContext;
let bus: CommandBus<ShellContext>;
let storage: ReturnType<typeof ephemeralStorage>;

beforeEach(() => {
  storage = ephemeralStorage();
  context = buildShellContext(storage).context;
  const registry = createCommandRegistry<ShellContext>();
  for (const command of shellCommands(DESCRIPTORS)) registry.register(command);
  bus = createCommandBus(
    registry,
    createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('commands'),
  );
});

function run(id: string, args?: CommandInvocation['arguments']) {
  return bus.execute(context, {
    commandId: commandId(id),
    ...(args === undefined ? {} : { arguments: args }),
  });
}

function reason(id: string): string | undefined {
  const availability = bus.availability(context, commandId(id));
  return availability.available ? undefined : availability.reason;
}

function pressure() {
  return context.preferences.get().pressure;
}

describe('the pressure commands', () => {
  it('are registered with the shell, none undoable', () => {
    const ids = shellCommands(DESCRIPTORS).map((command) => command.id);
    for (const command of pressureCommands()) {
      expect(ids).toContain(command.id);
      expect(command.undoable).toBe(false);
    }
  });

  it('turn pen pressure off and on, each unavailable where it is already so', () => {
    expect(reason('tools.use-pen-pressure')).toBe('Pen pressure already sets the strength.');
    expect(run('tools.use-fixed-strength').kind).toBe('applied');
    expect(pressure().usePenPressure).toBe(false);
    expect(reason('tools.use-fixed-strength')).toBe('The fixed strength is already used.');
    expect(run('tools.use-pen-pressure').kind).toBe('applied');
    expect(pressure().usePenPressure).toBe(true);
  });

  it('set the fixed strength to the nearest step and keep it with the preferences', () => {
    expect(run('tools.set-fixed-strength', { strength: 0.42 }).kind).toBe('applied');
    expect(pressure().fixedStrength).toBe(0.4);
    expect(JSON.parse(storage.read(PREFERENCES_KEY) ?? '{}')).toMatchObject({
      pressure: { fixedStrength: 0.4 },
    });
  });

  it('refuse a strength that is no number, and say the range', () => {
    const outcome = run('tools.set-fixed-strength', { strength: 'firm' });
    expect(outcome.kind).toBe('refused');
    expect(outcome.kind === 'refused' && outcome.failures[0].summary).toBe(
      'Choose a strength from 5% to 100%.',
    );
  });

  it('step the fixed strength one step of its control, and stop at each end', () => {
    run('tools.set-fixed-strength', { strength: 0.5 });
    run('tools.raise-fixed-strength');
    expect(pressure().fixedStrength).toBe(0.55);
    run('tools.lower-fixed-strength');
    run('tools.lower-fixed-strength');
    expect(pressure().fixedStrength).toBe(0.45);
    // A step lands on the control's own value, never on the sum's rounding.
    run('tools.set-fixed-strength', { strength: 0.1 });
    run('tools.raise-fixed-strength');
    expect(pressure().fixedStrength).toBe(0.15);

    run('tools.set-fixed-strength', { strength: FIXED_STRENGTH_RANGE.maximum });
    expect(reason('tools.raise-fixed-strength')).toBe(
      'The fixed strength is already at its strongest.',
    );
    run('tools.set-fixed-strength', { strength: FIXED_STRENGTH_RANGE.minimum });
    expect(reason('tools.lower-fixed-strength')).toBe(
      'The fixed strength is already at its weakest.',
    );
  });
});
