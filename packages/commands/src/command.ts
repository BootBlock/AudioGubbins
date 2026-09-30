/**
 * What a command is.
 *
 * REQ-EDIT-073 requires every meaningful action to go through one typed command
 * system, whether it came from a menu, a context menu, a toolbar, a shortcut,
 * the palette, a touch gesture, the Inspector, or a future macro or script.
 * That is only worth doing if the single route is genuinely richer than a
 * function call: it has to carry validation, target resolution, undo, grouping,
 * discovery and diagnostics, or callers will reasonably bypass it.
 *
 * The registry is generic over its context. The machinery lives here; the
 * commands themselves live with the subsystem they act on, so that adding a
 * workspace command does not mean this package learning about docking. That
 * keeps the dependency direction right and keeps this package from growing into
 * the catch-all that REQ-EXEC-136.2 prohibits.
 */

import { FailureKind, failure, type DomainFailure } from '@audiogubbins/domain';

declare const CommandIdTag: unique symbol;

/**
 * Identifies a command.
 *
 * Stable and machine-readable, for example `workspace.reset-layout`. A shortcut
 * profile, a menu definition and a future macro all refer to a command by this,
 * so it must never be derived from a label (REQ-PRIV-164).
 */
export type CommandId = string & { readonly [CommandIdTag]: 'CommandId' };

/** The shape every command identifier has. */
const COMMAND_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/;

/**
 * Whether a string is shaped like a command identifier.
 *
 * Asked where the string came from outside AudioGubbins: a macro, a replayed
 * journal entry or an imported profile can name anything, and `commandId`
 * throws. A command that takes an identifier from its arguments and does not
 * ask throws from a React event handler, where the failure boundary cannot
 * catch it.
 */
export function isCommandId(value: string): boolean {
  return COMMAND_ID.test(value);
}

/** Brands a string as a command identifier. */
export function commandId(value: string): CommandId {
  if (!COMMAND_ID.test(value)) {
    throw new Error(
      `"${value}" is not a valid command identifier. Use dotted lower-case segments, ` +
        'for example "workspace.reset-layout".',
    );
  }
  // The one place a command identifier is made, after the check above; a
  // brand exists only by being asserted, and this is where it is.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- a brand is minted here and nowhere else
  return value as CommandId;
}

/**
 * The refusal of one failure, or of several.
 *
 * The one place the refused outcome is spelt. The bus refuses with failures of
 * its own kinds and details, an unknown command or an unavailable one, and a
 * command refuses its own arguments through {@link refusal}; both build the
 * outcome here, so it has one shape and one home.
 */
export function refusedWith(problem: DomainFailure, ...more: DomainFailure[]): RefusedOutcome {
  return { kind: 'refused', failures: [problem, ...more] };
}

/**
 * Builds a refusal carrying one failure for each reason given, for a command
 * that refuses its own arguments or its own state.
 *
 * REQ-EDIT-073 requires a command to validate what it is given, and a command
 * that finds it wrong has to say so through its outcome rather than beside it:
 * the bus logs a refusal as a refusal, the interface voices it in one place,
 * and a replayed invocation learns that it was rejected. Exported, because a
 * shell command that could not build one would report a refusal as applied and
 * announce the reason through another channel.
 */
export function refusal(code: string, summary: string, ...more: string[]): RefusedOutcome {
  const rejected = (reason: string) => failure(code, FailureKind.Rejected, reason);
  return refusedWith(rejected(summary), ...more.map(rejected));
}

/**
 * The outcome of a command that found what it was asked for holding already.
 *
 * Not a refusal: the request was sound. Were it recorded as applied, a second
 * run with the same value would tell the log and the user of a change that did
 * not happen.
 *
 * `code` names what was already so, as {@link refusal}'s does, and is what a
 * log records. `reason` is the sentence for the user.
 */
export function unchanged(code: string, reason: string): UnchangedOutcome {
  return { kind: 'unchanged', code, reason };
}

/**
 * Where a command appears in menus and how the palette groups it.
 *
 * A closed set, because an open one would let each subsystem invent its own
 * grouping and leave the palette with forty categories of one command each.
 */
export const CommandCategory = {
  File: 'file',
  Edit: 'edit',
  Selection: 'selection',
  View: 'view',
  Workspace: 'workspace',
  Transport: 'transport',
  Tools: 'tools',
  Settings: 'settings',
  Help: 'help',
} as const;

/** Where a command appears in menus and how the palette groups it. */
export type CommandCategory = (typeof CommandCategory)[keyof typeof CommandCategory];

/**
 * Whether a command can run right now, and why not if it cannot.
 *
 * A disabled control that does not say why is an accessibility problem as much
 * as a usability one: a screen reader announces "dimmed" and nothing else.
 * REQ-UX-005 makes accessibility first-class, so the reason is part of the
 * answer rather than something the interface invents.
 */
export type CommandAvailability =
  { readonly available: true } | { readonly available: false; readonly reason: string };

/** The command can run. */
export const AVAILABLE: CommandAvailability = { available: true };

/** The command cannot run, for the stated British-English reason. */
export function unavailable(reason: string): CommandAvailability {
  return { available: false, reason };
}

/** What running a command produced. */
export type CommandOutcome<TContext> = AppliedOutcome<TContext> | UnchangedOutcome | RefusedOutcome;

/**
 * The command ran and changed something.
 *
 * `next` is the context after the change. The domain is immutable, so a command
 * that edits the project returns a context holding a new project rather than
 * having mutated the one every other holder still refers to (REQ-ARCH-153).
 */
export interface AppliedOutcome<TContext> {
  readonly kind: 'applied';
  readonly next: TContext;

  /**
   * How to reverse this, as another command invocation.
   *
   * Present only for a command that declares `undoable`. Expressing undo as an
   * invocation rather than a closure is what lets the history journal that
   * Phase 02 owns persist it: a closure cannot be written to storage, so a
   * journal built on closures cannot survive a reload, which is precisely when
   * a user most wants their history back.
   */
  readonly inverse?: CommandInvocation;

  /**
   * British-English description of what happened, for an undo menu entry.
   *
   * For example "Delete 3 regions". Present for an undoable command so the menu
   * can say what will be undone rather than only "Undo".
   */
  readonly description?: string;
}

/** The command ran and found nothing to do. */
export interface UnchangedOutcome {
  readonly kind: 'unchanged';

  /**
   * A name for what was already so, which a log can record.
   *
   * As a refusal carries a code beside its reason. The reason is written for
   * the user and can quote what they typed, a workspace's name among it, so a
   * log that recorded the reason would carry free-form content a bundle
   * excludes by default (REQ-PRIV-161).
   */
  readonly code: string;

  /** Why nothing happened, for example "The selection is already empty." */
  readonly reason: string;
}

/**
 * The command did not run.
 *
 * Distinct from `unchanged`: a refusal means the request was wrong or could not
 * be honoured, and the interface should say so. Returning `unchanged` for a
 * genuine failure is how a user comes to believe an action worked when it did
 * not.
 */
export interface RefusedOutcome {
  readonly kind: 'refused';
  readonly failures: readonly [DomainFailure, ...DomainFailure[]];
}

/** A request to run a command with particular arguments. */
export interface CommandInvocation {
  readonly commandId: CommandId;

  /**
   * Arguments, which must be serialisable.
   *
   * Constrained so that an invocation can be written to a history journal, a
   * saved macro or a shortcut binding. A closure or a live object here would
   * work in memory and fail the moment anything tried to persist it.
   */
  readonly arguments?: Readonly<Record<string, string | number | boolean | null>>;
}

/**
 * A command.
 *
 * @typeParam TContext - what the command reads and returns. Each subsystem
 * chooses its own, so a workspace command cannot reach into audio state simply
 * because both are commands.
 */
export interface Command<TContext> {
  readonly id: CommandId;

  /** British-English menu and palette label, for example "Reset layout". */
  readonly label: string;

  readonly category: CommandCategory;

  /**
   * Extra words the palette should match on.
   *
   * REQ-EDIT-073 requires command discovery. A user looking for the dark theme
   * may type "night" or "colour"; keywords are how the palette finds the
   * command without the label having to contain every synonym.
   */
  readonly keywords?: readonly string[];

  /** Longer British-English explanation, for a tooltip or the palette detail. */
  readonly description?: string;

  /**
   * Whether the palette offers the command. Offered unless this says `false`.
   *
   * `false` for a command a gesture runs with what only the gesture can supply:
   * a drag in the dock reports the arrangement it left, and nothing a user
   * types can. Offered in the palette, the command would match a search for
   * "move" beside the commands that move a panel from the keyboard, and a
   * keyboard or touch user who chose it would be told to drag. It stays a
   * command, reachable by the gesture and by a macro, as REQ-EDIT-073 requires
   * of a gesture.
   */
  readonly discoverable?: boolean;

  /**
   * Whether the command changes only how the whole interface is drawn: its
   * theme, brightness, contrast, density, accent or motion. Such a change is
   * seen in a modal dialogue as much as on the page behind it, so its shortcut
   * is the one kind that runs while a modal dialogue is open; every other acts
   * on that page, or opens something over it, and waits until it closes.
   */
  readonly changesAppearance?: boolean;

  /**
   * Whether the command's effect can be reversed.
   *
   * A command that declares this must return an `inverse` when it applies. A
   * command that reaches outside AudioGubbins, such as writing a file the user
   * chose, must not declare it: REQ-ARCH invariants prohibit presenting an
   * external side effect as undoable.
   */
  readonly undoable: boolean;

  /**
   * Whether the command can run against this context.
   *
   * Called to decide whether a menu entry is enabled and whether the palette
   * offers the command, so it must be cheap and must not change anything.
   */
  availability(context: TContext): CommandAvailability;

  /**
   * Runs the command.
   *
   * Called only after `availability` has allowed it, but an implementation must
   * still validate its arguments: a macro, a script or a replayed journal entry
   * can invoke a command with arguments no interface would have produced.
   */
  run(context: TContext, invocation: CommandInvocation): CommandOutcome<TContext>;
}
