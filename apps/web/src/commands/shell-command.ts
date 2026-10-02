/**
 * How a shell command is built.
 *
 * Shared by every shell command so that none of them re-decides what a command
 * is. They are all alike in the ways that matter: none is undoable, each acts
 * on a store and returns the context unchanged, and each reports its own
 * refusal through the same channel.
 *
 * None of them is undoable. Each changes a preference, a workspace or an
 * interface state, and REQ-EDIT-073 keeps Undo for project changes: a user
 * pressing Undo after a mistaken edit must not find it switching their theme
 * back instead.
 *
 * How a body speaks. A body whose store may refuse passes the store's answer to
 * `report`, which returns the refusal and says the success; a body that cannot
 * refuse by the time it acts says its success with
 * `context.interaction.announce` and returns nothing. It never says a refusal:
 * the refusal is returned, and `executeVoiced` says it for whoever ran the
 * command.
 */

import { FeatureStatus, NAMING, type CapabilityRegistry } from '@audiogubbins/capabilities';
import {
  AVAILABLE,
  unavailable,
  type Command,
  type CommandAvailability,
  type CommandCategory,
  type CommandInvocation,
  type CommandOutcome,
  type RefusedOutcome,
  type UnchangedOutcome,
  commandId,
  refusal,
} from '@audiogubbins/commands';

import type { Reasons } from '../state/reasons.js';
import type { ShellContext } from './shell-context.js';

/**
 * What a shell command's body answers: why it refused, that it found what it
 * was asked for holding already (the bus's own `unchanged` outcome), or
 * nothing at all when it did what it was asked.
 *
 * `void` beside the reasons, because most bodies do their work and return
 * nothing: the alternative is `return undefined` at the end of twenty
 * commands, which says less than it costs. The rule guards against `void`
 * written where a value was meant, which is not the case here.
 */
// eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- a body refuses, finds nothing to do, or returns nothing
export type BodyAnswer = string | Reasons | UnchangedOutcome | void;

/** What a shell command may be given besides its identity. */
export interface ShellCommandOptions {
  readonly keywords?: readonly string[];
  readonly description?: string;
  readonly discoverable?: boolean;
  readonly availability?: (
    context: ShellContext,
  ) => ReturnType<Command<ShellContext>['availability']>;
}

/**
 * A command that changes something without being undoable.
 *
 * The body returns the reason it refused, the outcome that it found nothing to
 * do, or nothing when it did what it was asked. A body that returns a reason
 * becomes a refusal the bus logs as one and the interface voices once. A body
 * that announced a refusal itself and returned would report success to
 * everything above it, and a rejected arrangement would be recorded as an
 * applied one.
 */
export function shellCommand(
  id: string,
  label: string,
  category: CommandCategory,
  run: (context: ShellContext, invocation: CommandInvocation) => BodyAnswer,
  extra: ShellCommandOptions = {},
): Command<ShellContext> {
  return {
    id: commandId(id),
    label,
    category,
    undoable: false,
    availability: extra.availability ?? (() => AVAILABLE),
    run(context, invocation): CommandOutcome<ShellContext> {
      const answer = run(context, invocation);
      if (typeof answer === 'string') return refusal(`${id}.refused`, answer);
      if (isReasons(answer)) return refusalFor(`${id}.refused`, answer);
      if (answer !== undefined) return answer;

      // The context is the set of stores, which do not change identity when
      // their contents do. Returning it unchanged is correct: the stores
      // notified their own subscribers, and the command layer is not the route
      // by which the interface learns about it.
      return { kind: 'applied', next: context };
    },
    ...(extra.keywords === undefined ? {} : { keywords: extra.keywords }),
    ...(extra.description === undefined ? {} : { description: extra.description }),
    ...(extra.discoverable === undefined ? {} : { discoverable: extra.discoverable }),
  };
}

/**
 * Available, or unavailable for the reason a store gives.
 *
 * How a command's availability reads a store's answer to "why not". One helper
 * for every command module, so no module decides for itself what an answer
 * means.
 */
export function availableUnless(problem: string | undefined): CommandAvailability {
  return problem === undefined ? AVAILABLE : unavailable(problem);
}

/**
 * Why nothing can be named in this browser, pointing at the capability that
 * says why, or `undefined` where names can be compared.
 *
 * Read from the capability the Capabilities panel lists and the status bar
 * counts, so a command that names is unavailable for the reason shown there
 * from the start, rather than failing at the first name given.
 */
function namingProblem(capabilities: CapabilityRegistry): string | undefined {
  const naming = capabilities.featureAvailability(NAMING);
  return naming.status === FeatureStatus.Unavailable
    ? `${naming.label} is unavailable in this browser; the Capabilities panel says why.`
    : undefined;
}

/**
 * `extra`, for a command that gives a workspace or a shortcut profile a name
 * where `names` holds: unavailable for its own reason first, as its store
 * refuses, and then where nothing can be named here (see
 * {@link namingProblem}).
 */
function naming(
  extra: ShellCommandOptions,
  names: (context: ShellContext) => boolean,
): ShellCommandOptions {
  return {
    ...extra,
    availability: (context) => {
      const own = extra.availability?.(context) ?? AVAILABLE;
      if (!own.available || !names(context)) return own;
      return availableUnless(namingProblem(context.capabilities));
    },
  };
}

/**
 * A command that gives a workspace or a shortcut profile a name: saving as,
 * copying, renaming, importing. Built as {@link shellCommand} builds one, and
 * unavailable where this browser cannot compare names.
 */
export function namingCommand(
  id: string,
  label: string,
  category: CommandCategory,
  run: (context: ShellContext, invocation: CommandInvocation) => BodyAnswer,
  extra: ShellCommandOptions = {},
): Command<ShellContext> {
  return shellCommand(
    id,
    label,
    category,
    run,
    naming(extra, () => true),
  );
}

/**
 * A command that changes the shortcuts in force, which, where they are the
 * built-in ones, it changes in a copy it names: unavailable then where this
 * browser cannot compare names, and a profile the user made is changed as
 * ever.
 */
export function builtInCopyingCommand(
  id: string,
  label: string,
  category: CommandCategory,
  run: (context: ShellContext, invocation: CommandInvocation) => BodyAnswer,
  extra: ShellCommandOptions = {},
): Command<ShellContext> {
  const inForce = (context: ShellContext): boolean => context.shortcuts.get().profile.builtIn;
  return shellCommand(id, label, category, run, naming(extra, inForce));
}

/** Whether a body's answer is its reasons for refusing. */
function isReasons(answer: BodyAnswer): answer is Reasons {
  return Array.isArray(answer);
}

/** A refusal of one failure for each reason, in order. */
function refusalFor(code: string, reasons: Reasons): RefusedOutcome {
  const [first, ...rest] = reasons;
  return refusal(code, first, ...rest);
}

/**
 * One text argument of an invocation, or `undefined`.
 *
 * REQ-EDIT-073 requires target resolution, and an invocation's arguments are
 * how a caller names a target. They are read rather than trusted: a macro, a
 * script or a replayed journal entry can invoke a command with arguments no
 * interface would have produced.
 */
export function textArgument(invocation: CommandInvocation, name: string): string | undefined {
  const value = invocation.arguments?.[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Announces what a command did, and hands back what it refused.
 *
 * Success is said here, because nothing above the command knows what to say
 * about it. A refusal is returned instead of being said here, and
 * `executeVoiced` says it for every interface route to the bus. Announcing it
 * here as well would say it twice.
 */
export function report(
  context: ShellContext,
  refused: string | Reasons | undefined,
  success: string,
): string | Reasons | undefined {
  if (refused !== undefined) return refused;

  context.interaction.announce(success);
  return undefined;
}
