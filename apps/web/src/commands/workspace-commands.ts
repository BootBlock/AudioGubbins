/**
 * Everything a user can do to a workspace as a whole.
 *
 * REQ-UX-058 states with `shall` that users can create, save, duplicate,
 * rename, reset, delete and switch rapidly between layouts. Each of those is a
 * command, so each is reachable from a menu, the palette, a shortcut and a
 * future macro by the one route REQ-EDIT-073 requires.
 *
 * The ones that need a name take it as an invocation argument rather than
 * opening a dialogue. A command runs from a macro and from a shortcut as well
 * as from a menu, so it cannot open a dialogue and wait for an answer; the
 * Workspace settings section is where the user types the name. With none
 * given, a new workspace or a copy is named by the layout store, by one rule
 * from every route.
 *
 * What is done to the panels inside a workspace is `panel-commands.ts`.
 */

import {
  AVAILABLE,
  CommandCategory,
  unavailable,
  unchanged,
  type Command,
} from '@audiogubbins/commands';
import type { WorkspaceLayout } from '@audiogubbins/workspace';

import { isRecoveryPart, subjectOf } from '../state/recovery-notices.js';
import {
  availableUnless,
  namingCommand,
  report,
  shellCommand,
  textArgument,
} from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** The layout the user is looking at. */
function current(context: ShellContext) {
  return context.workspace.get().layout;
}

/** Why there is no workspace to switch to. */
const ONLY_ONE_WORKSPACE = 'There is only one workspace.';

/**
 * Says what an operation did, through {@link report}, worded from the
 * workspace the store answers with, or answers why it was refused.
 *
 * From the answer rather than from what is mounted afterwards, so a sentence
 * names the workspace the operation made or changed whichever one the store
 * leaves on screen, and is worded only once there is one to name.
 */
function announced(
  context: ShellContext,
  answer: WorkspaceLayout | string,
  said: (layout: WorkspaceLayout) => string,
): string | undefined {
  if (typeof answer === 'string') return answer;
  report(context, undefined, said(answer));
  return undefined;
}

/**
 * Rename's refusal of the workspace under `id`, which on a built-in one
 * advises a copy where `duplicate` can make one.
 *
 * The store refuses a built-in workspace for what it is, and cannot know
 * whether this browser can make a copy. Advised where none can be made, the
 * reader would be sent to a Duplicate that says it cannot run. Read from the
 * command's own availability, so Rename follows whatever Duplicate decides.
 */
function renameRefusal(
  context: ShellContext,
  id: string,
  refusal: string,
  duplicate: Command<ShellContext>,
): string {
  const builtIn = context.workspace.get().available.some((one) => one.id === id && one.builtIn);
  return builtIn && duplicate.availability(context).available
    ? `${refusal} Duplicate it first.`
    : refusal;
}

/**
 * Why Rename cannot run on the workspace in use, as {@link renameRefusal}
 * words it, or `undefined` when it can.
 */
function renameProblem(
  context: ShellContext,
  duplicate: Command<ShellContext>,
): string | undefined {
  const { id } = current(context);
  const refusal = context.workspace.renamingProblem(id);
  return refusal === undefined ? undefined : renameRefusal(context, id, refusal, duplicate);
}

/** Switching, saving, copying, renaming, resetting and deleting a workspace. */
function layoutCommands(): readonly Command<ShellContext>[] {
  const duplicate = namingCommand(
    'workspace.duplicate',
    'Duplicate this workspace',
    CommandCategory.Workspace,
    (context, invocation) => {
      const source = textArgument(invocation, 'layoutId') ?? current(context).id;
      const copy = context.workspace.duplicate(source, textArgument(invocation, 'displayName'));
      return announced(context, copy, (made) => `Copied it as "${made.displayName}".`);
    },
    {
      keywords: ['layout', 'workspace', 'duplicate', 'copy'],
      description:
        'Copies a workspace under a new name, which is how a built-in one becomes a starting point you can change.',
    },
  );

  return [
    shellCommand(
      'workspace.switch-to',
      'Switch workspace',
      CommandCategory.Workspace,
      (context, invocation) => {
        // Target resolution, which REQ-EDIT-073 names as something the command
        // architecture has to support. A menu entry names the workspace it is
        // for; a shortcut and the palette name nothing, and moving to the next
        // one is what "switch rapidly between layouts" asks for.
        const named = textArgument(invocation, 'layoutId');
        const target = named ?? context.workspace.nextLayoutId();

        if (target === undefined) return ONLY_ONE_WORKSPACE;

        const refusal = context.workspace.switchTo(target);
        return report(
          context,
          refusal,
          `Switched to "${context.workspace.get().layout.displayName}".`,
        );
      },
      {
        keywords: ['workspace', 'layout', 'switch', 'preset', 'next'],
        description:
          'Moves to another workspace. Choose one from the Workspace menu, or run this on its own to move to the next.',
        // The body's own rule: with nothing after the one in use, there is
        // nothing to switch to.
        availability: (context) =>
          context.workspace.nextLayoutId() === undefined
            ? unavailable(ONLY_ONE_WORKSPACE)
            : AVAILABLE,
      },
    ),

    namingCommand(
      'workspace.save-as',
      'Save this workspace as a new one',
      CommandCategory.Workspace,
      (context, invocation) =>
        announced(
          context,
          context.workspace.saveAs(textArgument(invocation, 'displayName')),
          (saved) => `Saved this arrangement as "${saved.displayName}".`,
        ),
      { keywords: ['layout', 'workspace', 'save', 'create', 'new'] },
    ),

    duplicate,

    namingCommand(
      'workspace.rename',
      'Rename this workspace',
      CommandCategory.Workspace,
      (context, invocation) => {
        const target = textArgument(invocation, 'layoutId') ?? current(context).id;
        const displayName = textArgument(invocation, 'displayName');

        if (displayName === undefined) return 'Type the new name in the Workspace settings.';

        // The store refuses a built-in workspace before it reads the name, so
        // one asked for its own name is refused, which is not the same as
        // nothing to do. Said by the names the store answers with, the one
        // typed without the space around it: " Mix " renames a workspace to
        // "Mix", and a workspace called "Mix" already is left as it is.
        const renamed = context.workspace.rename(target, displayName);
        if (typeof renamed === 'string') return renameRefusal(context, target, renamed, duplicate);
        const { before, after } = renamed;
        if (after === before) {
          return unchanged(
            'workspace.already-named',
            `That workspace is already called "${after.displayName}".`,
          );
        }
        return report(
          context,
          undefined,
          `"${before.displayName}" is now called "${after.displayName}".`,
        );
      },
      {
        keywords: ['layout', 'workspace', 'rename', 'name'],
        description: 'Renames a workspace you made. Built-in workspaces keep their names.',
        availability: (context) => availableUnless(renameProblem(context, duplicate)),
      },
    ),

    shellCommand(
      'workspace.reset',
      'Reset this workspace',
      CommandCategory.Workspace,
      (context, invocation) => {
        const target = textArgument(invocation, 'layoutId') ?? current(context).id;
        return announced(
          context,
          context.workspace.resetBuiltIn(target),
          (shipped) => `"${shipped.displayName}" is back to how it ships.`,
        );
      },
      {
        keywords: ['layout', 'workspace', 'default', 'restore', 'reset'],
        availability: (context) =>
          availableUnless(context.workspace.resetProblem(current(context).id)),
      },
    ),

    shellCommand(
      'workspace.delete',
      'Delete this workspace',
      CommandCategory.Workspace,
      (context, invocation) => {
        const target = textArgument(invocation, 'layoutId') ?? current(context).id;
        return announced(
          context,
          context.workspace.remove(target),
          (removed) => `"${removed.displayName}" is deleted.`,
        );
      },
      {
        keywords: ['layout', 'workspace', 'delete', 'remove'],
        description:
          'Deletes a workspace you made. The arrangement goes; nothing in your project changes.',
        availability: (context) =>
          availableUnless(context.workspace.removalProblem(current(context).id)),
      },
    ),
  ];
}

/**
 * Dismissing the notice that a stored workspace could not be used, so a user
 * whose layout was recovered once does not see the explanation in the status
 * bar for the rest of the session.
 */
function dismissNoticeCommand(): Command<ShellContext> {
  return shellCommand(
    'workspace.dismiss-notice',
    'Dismiss a workspace notice',
    CommandCategory.Workspace,
    (context, invocation) => {
      // Named, because there can be two: the workspace on screen and the
      // collection of saved ones are recovered separately, and each is
      // dismissed alone. The status bar's buttons name theirs; from the
      // palette, which cannot, the oldest is dismissed and the announcement
      // says which it was.
      const named = textArgument(invocation, 'part');
      if (named !== undefined && !isRecoveryPart(named)) {
        return `There is no workspace notice called "${named}".`;
      }

      const [oldest] = context.workspace.get().recoveries;
      const part = named ?? oldest?.part;
      if (part === undefined) return NO_NOTICE_TO_DISMISS;

      return report(
        context,
        context.workspace.acknowledgeRecovery(part),
        `The notice about ${subjectOf(part)} is dismissed.`,
      );
    },
    {
      keywords: ['workspace', 'notice', 'dismiss', 'recovered', 'hide'],
      availability: (context) =>
        context.workspace.get().recoveries.length === 0
          ? unavailable(NO_NOTICE_TO_DISMISS)
          : AVAILABLE,
    },
  );
}

/** The refusal when there is no notice left, for the answer and the availability alike. */
const NO_NOTICE_TO_DISMISS = 'There is no workspace notice to dismiss.';

/** Every command that acts on a workspace as a whole. */
export function workspaceCommands(): readonly Command<ShellContext>[] {
  return [...layoutCommands(), dismissNoticeCommand()];
}
