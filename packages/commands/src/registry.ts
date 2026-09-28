/**
 * The command registry and the one route through which commands run.
 *
 * REQ-EDIT-073 requires validation, target resolution, undo integration,
 * transaction grouping and telemetry-free diagnostics to happen for every
 * action however it was started. Putting them here rather than in each caller
 * is the point of having a single route: a menu item, a shortcut and a future
 * macro cannot each remember to do them.
 */

import { FailureKind, failure } from '@audiogubbins/domain';
import type { Logger } from '@audiogubbins/diagnostics';

import type {
  Command,
  CommandAvailability,
  CommandCategory,
  CommandId,
  CommandInvocation,
  CommandOutcome,
  RefusedOutcome,
  UnchangedOutcome,
} from './command.js';
import { refusedWith, unchanged } from './command.js';

/**
 * The code of the failure a command is refused with when it is unavailable.
 *
 * Named, because what the refusal means differs from any other: the request
 * was sound, and the state it asked for holds already or cannot hold yet. An
 * interface says it more gently than a request that failed.
 */
export const UNAVAILABLE_FAILURE_CODE = 'command.unavailable';

/** Holds every command the application knows about. */
export interface CommandRegistry<TContext> {
  /**
   * Adds a command.
   *
   * Registering the same identifier twice throws. Two commands answering to one
   * identifier would make a shortcut binding, a menu entry and a journal entry
   * ambiguous, and the ambiguity would resolve differently depending on module
   * load order.
   */
  register(command: Command<TContext>): void;

  /** The command with this identifier, or `undefined`. */
  get(id: CommandId): Command<TContext> | undefined;

  /** Every registered command, in registration order. */
  all(): readonly Command<TContext>[];

  /** Every registered command in a category. */
  inCategory(category: CommandCategory): readonly Command<TContext>[];
}

/** Creates an empty registry. */
export function createCommandRegistry<TContext>(): CommandRegistry<TContext> {
  const commands = new Map<CommandId, Command<TContext>>();

  return {
    register(command) {
      if (commands.has(command.id)) {
        throw new Error(
          `The command "${command.id}" is already registered. Two commands sharing an ` +
            'identifier would make every shortcut, menu entry and history entry ambiguous.',
        );
      }
      commands.set(command.id, command);
    },

    get: (id) => commands.get(id),

    all: () => [...commands.values()],

    inCategory: (category) =>
      [...commands.values()].filter((command) => command.category === category),
  };
}

/**
 * One reversible step, ready for the history journal Phase 02 owns.
 *
 * Holds invocations rather than closures so that it can be written to storage
 * and replayed after a reload. A journal of closures is a journal that does not
 * survive the crash it exists for.
 */
export interface HistoryEntry {
  /** British-English text for the undo menu, for example "Delete 3 regions". */
  readonly description: string;

  /** What was done, in order. */
  readonly forward: readonly [CommandInvocation, ...CommandInvocation[]];

  /** What reverses it, in the order it must be replayed: last change first. */
  readonly inverse: readonly [CommandInvocation, ...CommandInvocation[]];
}

/** The result of asking the bus to run something. */
export type ExecutionResult<TContext> =
  AppliedExecution<TContext> | UnchangedOutcome | RefusedOutcome;

/** The command or group ran and changed something. */
export interface AppliedExecution<TContext> {
  readonly kind: 'applied';
  readonly next: TContext;

  /**
   * The step to add to the history, present only when it can be reversed.
   *
   * Absent for a command that changes something genuinely not undoable, such as
   * a user preference. Manufacturing an entry for one of those would put a step
   * in the history that Undo could not honour, and an Undo that silently does
   * nothing is worse than no entry at all.
   */
  readonly entry?: HistoryEntry;
}

/** Runs commands and reports what happened. */
export interface CommandBus<TContext> {
  /** Whether the command could run against this context right now. */
  availability(context: TContext, id: CommandId): CommandAvailability;

  /** Runs one command. */
  execute(context: TContext, invocation: CommandInvocation): ExecutionResult<TContext>;

  /**
   * Runs several commands as one undoable step.
   *
   * REQ-EDIT-073 requires transaction grouping. Without it, an action a user
   * experienced as one thing, such as splitting a clip and selecting the right
   * half, would take two presses of Undo to reverse and would leave the project
   * in a state they never saw in between.
   *
   * If any command refuses, nothing is applied and the caller keeps the context
   * it passed in. A half-applied group is worse than a refused one, because the
   * user cannot tell which half happened.
   */
  executeGroup(
    context: TContext,
    description: string,
    invocations: readonly [CommandInvocation, ...CommandInvocation[]],
  ): ExecutionResult<TContext>;
}

/**
 * Creates the bus.
 *
 * The logger records what ran and what refused. REQ-PRIV-162 prohibits usage
 * analytics, so this is diagnostic and local: it records that a command was
 * refused and why, never which commands a person favours.
 */
export function createCommandBus<TContext>(
  registry: CommandRegistry<TContext>,
  logger: Logger,
): CommandBus<TContext> {
  /** Runs one command, without deciding what it means for the history. */
  const runOne = (context: TContext, invocation: CommandInvocation): CommandOutcome<TContext> => {
    const command = registry.get(invocation.commandId);
    if (command === undefined) {
      return refusedWith(
        failure(
          'command.unknown',
          FailureKind.Rejected,
          `There is no command "${invocation.commandId}".`,
          { details: { commandId: invocation.commandId } },
        ),
      );
    }

    const canRun = command.availability(context);
    if (!canRun.available) {
      return refusedWith(
        failure(UNAVAILABLE_FAILURE_CODE, FailureKind.Conflict, canRun.reason, {
          details: { commandId: invocation.commandId },
        }),
      );
    }

    const outcome = command.run(context, invocation);

    if (outcome.kind === 'applied' && command.undoable && outcome.inverse === undefined) {
      // A command that promises to be undoable and then does not say how has
      // broken its own contract. Accepting the change would put a step into the
      // history that Undo cannot reverse, so the change is refused instead.
      return refusedWith(
        failure(
          'command.undoable-without-inverse',
          FailureKind.IntegrityViolation,
          `The command "${invocation.commandId}" declares itself undoable but did not say how to reverse what it did.`,
          { details: { commandId: invocation.commandId } },
        ),
      );
    }

    return outcome;
  };

  return {
    availability(context, id) {
      const command = registry.get(id);
      return command === undefined
        ? { available: false, reason: `There is no command "${id}".` }
        : command.availability(context);
    },

    execute(context, invocation) {
      const outcome = runOne(context, invocation);

      if (outcome.kind === 'refused') {
        logger.warning('A command was refused.', {
          commandId: invocation.commandId,
          firstFailure: outcome.failures[0].code,
        });
        return outcome;
      }

      if (outcome.kind === 'unchanged') {
        logger.debug('A command found nothing to do.', {
          commandId: invocation.commandId,
          code: outcome.code,
        });
        return outcome;
      }

      logger.debug('A command was applied.', { commandId: invocation.commandId });

      const command = registry.get(invocation.commandId);
      if (command?.undoable !== true || outcome.inverse === undefined) {
        return { kind: 'applied', next: outcome.next };
      }

      return {
        kind: 'applied',
        next: outcome.next,
        entry: {
          description: outcome.description ?? command.label,
          forward: [invocation],
          inverse: [outcome.inverse],
        },
      };
    },

    executeGroup(context, description, invocations) {
      const forward: CommandInvocation[] = [];
      const inverse: CommandInvocation[] = [];
      let working = context;
      let applied = false;

      for (const invocation of invocations) {
        const outcome = runOne(working, invocation);

        if (outcome.kind === 'refused') {
          logger.warning('A command group was abandoned without applying anything.', {
            description,
            commandId: invocation.commandId,
            firstFailure: outcome.failures[0].code,
          });
          return outcome;
        }

        if (outcome.kind === 'unchanged') continue;

        working = outcome.next;
        applied = true;
        forward.push(invocation);

        // Reversing the group means reversing its changes newest first, so each
        // inverse goes to the front as it is produced.
        if (outcome.inverse !== undefined) inverse.unshift(outcome.inverse);
      }

      if (!applied) {
        return unchanged('group.nothing-changed', 'No command in the group changed anything.');
      }

      logger.debug('A command group was applied.', {
        description,
        commandCount: forward.length,
      });

      const [firstForward, ...restForward] = forward;
      const [firstInverse, ...restInverse] = inverse;

      // A group is reversible only if every change it made is. Recording a
      // partial inverse would make Undo restore some of the group and leave the
      // rest, which is a state the user never saw.
      if (
        firstForward === undefined ||
        firstInverse === undefined ||
        inverse.length !== forward.length
      ) {
        return { kind: 'applied', next: working };
      }

      return {
        kind: 'applied',
        next: working,
        entry: {
          description,
          forward: [firstForward, ...restForward],
          inverse: [firstInverse, ...restInverse],
        },
      };
    },
  };
}
