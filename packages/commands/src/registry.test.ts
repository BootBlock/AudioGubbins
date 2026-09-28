import { beforeEach, describe, expect, it } from 'vitest';

import type { LogRecord } from '@audiogubbins/diagnostics';

import { CommandCategory, commandId, type CommandInvocation } from './command.js';
import {
  createCommandBus,
  createCommandRegistry,
  type CommandBus,
  type CommandRegistry,
} from './registry.js';
import {
  alwaysRefusesCommand,
  brokenUndoCommand,
  incrementCommand,
  notUndoableCommand,
  testLogger,
  type CounterContext,
} from './testing/test-commands.js';

const START: CounterContext = { value: 0, enabled: true };

function increment(by: number): CommandInvocation {
  return { commandId: commandId('test.increment'), arguments: { by } };
}

describe('commandId', () => {
  it('accepts a dotted lower-case identifier', () => {
    expect(commandId('workspace.reset-layout')).toBe('workspace.reset-layout');
  });

  it('accepts several segments', () => {
    expect(commandId('view.panel.toggle-inspector')).toBe('view.panel.toggle-inspector');
  });

  it.each([
    'noDot',
    'Workspace.Reset',
    'workspace.Reset-Layout',
    'workspace..reset',
    'workspace.',
    '.reset',
    'workspace.reset layout',
    'workspace.reset_layout',
  ])('rejects "%s", so a binding cannot refer to two spellings of one command', (value) => {
    expect(() => commandId(value)).toThrow();
  });
});

describe('createCommandRegistry', () => {
  let registry: CommandRegistry<CounterContext>;

  beforeEach(() => {
    registry = createCommandRegistry<CounterContext>();
  });

  it('finds a registered command', () => {
    registry.register(incrementCommand);
    expect(registry.get(incrementCommand.id)).toBe(incrementCommand);
  });

  it('returns undefined for a command nobody registered', () => {
    expect(registry.get(commandId('test.absent'))).toBeUndefined();
  });

  it('refuses a duplicate identifier rather than letting load order decide', () => {
    registry.register(incrementCommand);
    expect(() => {
      registry.register(incrementCommand);
    }).toThrow(/already registered/);
  });

  it('lists commands by category', () => {
    registry.register(incrementCommand);
    registry.register(notUndoableCommand);

    expect(registry.inCategory(CommandCategory.Edit)).toEqual([incrementCommand]);
    expect(registry.inCategory(CommandCategory.Settings)).toEqual([notUndoableCommand]);
    expect(registry.inCategory(CommandCategory.Help)).toEqual([]);
  });
});

describe('command execution', () => {
  let bus: CommandBus<CounterContext>;
  let recorded: () => readonly LogRecord[];

  beforeEach(() => {
    const registry = createCommandRegistry<CounterContext>();
    registry.register(incrementCommand);
    registry.register(brokenUndoCommand);
    registry.register(notUndoableCommand);
    registry.register(alwaysRefusesCommand);

    const log = testLogger();
    recorded = log.records;
    bus = createCommandBus(registry, log.logger);
  });

  it('applies a command and returns the changed context', () => {
    const result = bus.execute(START, increment(3));
    expect(result.kind).toBe('applied');
    if (result.kind === 'applied') expect(result.next.value).toBe(3);
  });

  it('leaves the context it was given untouched', () => {
    bus.execute(START, increment(3));
    expect(START.value).toBe(0);
  });

  it('records an inverse that reverses the change', () => {
    const result = bus.execute(START, increment(3));
    if (result.kind !== 'applied' || result.entry === undefined) {
      throw new Error('expected an undoable application');
    }

    const undone = bus.execute(result.next, result.entry.inverse[0]);
    if (undone.kind !== 'applied') throw new Error('expected the inverse to apply');
    expect(undone.next.value).toBe(START.value);
  });

  it('describes the step for the undo menu', () => {
    const result = bus.execute(START, increment(3));
    if (result.kind !== 'applied') throw new Error('expected an application');
    expect(result.entry?.description).toBe('Increase by 3');
  });

  it('refuses a command nobody registered', () => {
    const result = bus.execute(START, { commandId: commandId('test.absent') });
    expect(result.kind).toBe('refused');
    if (result.kind === 'refused') expect(result.failures[0].code).toBe('command.unknown');
  });

  it('refuses a command that reports itself unavailable, and says why', () => {
    const result = bus.execute({ value: 0, enabled: false }, increment(1));
    expect(result.kind).toBe('refused');
    if (result.kind === 'refused') {
      expect(result.failures[0].code).toBe('command.unavailable');
      expect(result.failures[0].summary).toBe('The counter is switched off.');
    }
  });

  it('refuses arguments no interface would have produced', () => {
    const result = bus.execute(START, { commandId: commandId('test.increment') });
    expect(result.kind).toBe('refused');
    if (result.kind === 'refused') {
      expect(result.failures[0].code).toBe('test.increment-needs-a-number');
    }
  });

  it('reports doing nothing as unchanged rather than as applied', () => {
    const result = bus.execute(START, increment(0));
    expect(result.kind).toBe('unchanged');
    if (result.kind === 'unchanged') expect(result.reason).toContain('zero');
  });

  it('refuses a command that promises to be undoable and does not say how', () => {
    const result = bus.execute(START, { commandId: commandId('test.broken-undo') });
    expect(result.kind).toBe('refused');
    if (result.kind === 'refused') {
      expect(result.failures[0].code).toBe('command.undoable-without-inverse');
      expect(result.failures[0].kind).toBe('integrity-violation');
    }
  });

  it('applies a command that is not undoable without inventing a history entry', () => {
    const result = bus.execute(START, { commandId: commandId('test.disable') });
    expect(result.kind).toBe('applied');
    if (result.kind === 'applied') {
      expect(result.next.enabled).toBe(false);
      expect(result.entry).toBeUndefined();
    }
  });

  it('logs a refusal locally, without recording which commands are popular', () => {
    // The command and why it was refused, each time, and nothing that counts
    // how often it is run: every record the two refusals left is read, so a
    // record beside the refusal that counts it would be seen.
    const before = recorded().length;
    bus.execute(START, { commandId: commandId('test.always-refuses') });
    bus.execute(START, { commandId: commandId('test.always-refuses') });

    expect(
      recorded()
        .slice(before)
        .map((one) => [one.message, one.fields]),
    ).toEqual([
      [
        'A command was refused.',
        { commandId: 'test.always-refuses', firstFailure: 'test.refused' },
      ],
      [
        'A command was refused.',
        { commandId: 'test.always-refuses', firstFailure: 'test.refused' },
      ],
    ]);
  });

  it('records what a command found already so by name, not by the sentence', () => {
    // The sentence is written for the user and can quote what they typed, a
    // workspace's name among it, which a bundle excludes by default.
    bus.execute(START, increment(0));

    const found = recorded().find((one) => one.message === 'A command found nothing to do.');
    expect(found?.fields).toEqual({ commandId: 'test.increment', code: 'counter.no-step' });
  });
});

describe('availability', () => {
  it('reports a registered command as available', () => {
    const registry = createCommandRegistry<CounterContext>();
    registry.register(incrementCommand);
    const bus = createCommandBus(registry, testLogger().logger);

    expect(bus.availability(START, incrementCommand.id)).toEqual({ available: true });
  });

  it('gives a reason a control can announce when the command cannot run', () => {
    const registry = createCommandRegistry<CounterContext>();
    registry.register(incrementCommand);
    const bus = createCommandBus(registry, testLogger().logger);

    expect(bus.availability({ value: 0, enabled: false }, incrementCommand.id)).toEqual({
      available: false,
      reason: 'The counter is switched off.',
    });
  });

  it('reports an unregistered command as unavailable rather than throwing', () => {
    const bus = createCommandBus(createCommandRegistry<CounterContext>(), testLogger().logger);
    expect(bus.availability(START, commandId('test.absent')).available).toBe(false);
  });
});

describe('command groups', () => {
  let bus: CommandBus<CounterContext>;

  beforeEach(() => {
    const registry = createCommandRegistry<CounterContext>();
    registry.register(incrementCommand);
    registry.register(notUndoableCommand);
    registry.register(alwaysRefusesCommand);
    bus = createCommandBus(registry, testLogger().logger);
  });

  it('applies every command as one step', () => {
    const result = bus.executeGroup(START, 'Increase three times', [
      increment(1),
      increment(2),
      increment(3),
    ]);

    expect(result.kind).toBe('applied');
    if (result.kind === 'applied') expect(result.next.value).toBe(6);
  });

  it('reverses the whole group with one undo, newest change first', () => {
    const result = bus.executeGroup(START, 'Increase three times', [
      increment(1),
      increment(2),
      increment(3),
    ]);
    if (result.kind !== 'applied' || result.entry === undefined) {
      throw new Error('expected an undoable group');
    }
    // Increments commute, so returning to the start would not show the order.
    expect(result.entry.inverse).toEqual([increment(-3), increment(-2), increment(-1)]);

    let context = result.next;
    for (const invocation of result.entry.inverse) {
      const undone = bus.execute(context, invocation);
      if (undone.kind !== 'applied') throw new Error('expected the inverse to apply');
      context = undone.next;
    }

    expect(context.value).toBe(START.value);
  });

  it('carries the description the user will see under Undo', () => {
    const result = bus.executeGroup(START, 'Increase three times', [increment(1)]);
    if (result.kind !== 'applied') throw new Error('expected an application');
    expect(result.entry?.description).toBe('Increase three times');
  });

  it('applies nothing at all when any member refuses', () => {
    const result = bus.executeGroup(START, 'Increase then refuse', [
      increment(5),
      { commandId: commandId('test.always-refuses') },
      increment(5),
    ]);

    expect(result.kind).toBe('refused');
    // The caller keeps the context it passed in, so nothing was half-applied.
    expect(START.value).toBe(0);
  });

  it('skips a member that changes nothing and still applies the rest', () => {
    const result = bus.executeGroup(START, 'Increase around a no-op', [
      increment(2),
      increment(0),
      increment(3),
    ]);

    expect(result.kind).toBe('applied');
    if (result.kind === 'applied') {
      expect(result.next.value).toBe(5);
      expect(result.entry?.forward).toHaveLength(2);
    }
  });

  it('reports a group where nothing changed as unchanged', () => {
    const result = bus.executeGroup(START, 'Nothing', [increment(0), increment(0)]);
    expect(result.kind).toBe('unchanged');
  });

  it('offers no history entry when a member cannot be reversed', () => {
    const result = bus.executeGroup(START, 'Increase and switch off', [
      increment(1),
      { commandId: commandId('test.disable') },
    ]);

    expect(result.kind).toBe('applied');
    if (result.kind === 'applied') {
      // Half a group is not an undo. Offering one would restore the counter and
      // leave it switched off, which is a state the user never saw.
      expect(result.entry).toBeUndefined();
      expect(result.next).toEqual({ value: 1, enabled: false });
    }
  });
});
