/**
 * A small command set for this package's own tests.
 *
 * The registry is generic over its context, so testing it needs *some* context.
 * A counter is enough: it is immutable, it has an obvious inverse, and it makes
 * a wrong undo visible as a wrong number rather than as a subtly wrong project.
 *
 * Absent from the package's public entry point. Production code registers real
 * commands, and a shipped counter command would be exactly the fabricated
 * production behaviour REQ-EXEC-181 treats as a gate failure.
 */

import { FailureKind, failure } from '@audiogubbins/domain';
import {
  createLogStore,
  createDiagnosticCentre,
  type LogRecord,
  type Logger,
} from '@audiogubbins/diagnostics';

import {
  AVAILABLE,
  CommandCategory,
  commandId,
  unavailable,
  unchanged,
  type Command,
  type CommandOutcome,
} from '../command.js';

/** The context these test commands read and return. */
export interface CounterContext {
  readonly value: number;

  /** When false, every command reports itself unavailable. */
  readonly enabled: boolean;
}

/** Adds the `by` argument to the counter, and can be undone. */
export const incrementCommand: Command<CounterContext> = {
  id: commandId('test.increment'),
  label: 'Increase the counter',
  category: CommandCategory.Edit,
  keywords: ['add', 'plus'],
  undoable: true,

  availability: (context) =>
    context.enabled ? AVAILABLE : unavailable('The counter is switched off.'),

  run(context, invocation): CommandOutcome<CounterContext> {
    const by = invocation.arguments?.['by'];
    if (typeof by !== 'number' || !Number.isFinite(by)) {
      return {
        kind: 'refused',
        failures: [
          failure(
            'test.increment-needs-a-number',
            FailureKind.Rejected,
            'The "by" argument must be a finite number.',
          ),
        ],
      };
    }

    if (by === 0) {
      return unchanged('counter.no-step', 'Increasing by zero changes nothing.');
    }

    return {
      kind: 'applied',
      next: { ...context, value: context.value + by },
      inverse: { commandId: commandId('test.increment'), arguments: { by: -by } },
      description: `Increase by ${String(by)}`,
    };
  },
};

/** Sets the counter to zero. Declares itself undoable but never says how. */
export const brokenUndoCommand: Command<CounterContext> = {
  id: commandId('test.broken-undo'),
  label: 'Reset the counter without an inverse',
  category: CommandCategory.Edit,
  undoable: true,

  availability: () => AVAILABLE,

  run: (context): CommandOutcome<CounterContext> => ({
    kind: 'applied',
    next: { ...context, value: 0 },
  }),
};

/** Changes something real that Undo should not offer to reverse. */
export const notUndoableCommand: Command<CounterContext> = {
  id: commandId('test.disable'),
  label: 'Switch the counter off',
  category: CommandCategory.Settings,
  undoable: false,

  availability: () => AVAILABLE,

  run: (context): CommandOutcome<CounterContext> => ({
    kind: 'applied',
    next: { ...context, enabled: false },
  }),
};

/** Always refuses, so a group can be tested for leaving nothing half-applied. */
export const alwaysRefusesCommand: Command<CounterContext> = {
  id: commandId('test.always-refuses'),
  label: 'Refuse',
  category: CommandCategory.Tools,
  undoable: false,

  availability: () => AVAILABLE,

  run: (): CommandOutcome<CounterContext> => ({
    kind: 'refused',
    failures: [failure('test.refused', FailureKind.Rejected, 'This command always refuses.')],
  }),
};

/** A logger writing into a store the test can read. */
export function testLogger(): {
  readonly logger: Logger;
  records: () => readonly LogRecord[];
} {
  const store = createLogStore();
  const centre = createDiagnosticCentre(
    store,
    { now: () => 0 },
    {
      defaultSeverity: 'trace',
      categoryOverrides: {},
    },
  );

  return {
    logger: centre.loggerFor('commands'),
    records: () => store.snapshot(),
  };
}
