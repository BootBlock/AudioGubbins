/**
 * Everything a user can do to their shortcuts.
 *
 * REQ-UX-066 states that users must be able to fully remap shortcuts, and names
 * named profiles, import and export, and reset to defaults. Each operation is a
 * command here, so the shortcut editor acts through the same route as every
 * other surface and a future macro can rebuild a profile the way a user would
 * (REQ-EDIT-073).
 */

import {
  AVAILABLE,
  CommandCategory,
  commandId,
  describeShortcut,
  exportFileName,
  isCommandId,
  parseShortcut,
  platformReservation,
  shortcutKey,
  unavailable,
  unchanged,
  type Command,
} from '@audiogubbins/commands';

import { DEFAULT_PROFILE_ID } from '../state/default-shortcuts.js';
import { reasonsOf } from '../state/reasons.js';
import { noNoticeAbout, subjectOf } from '../state/recovery-notices.js';
import {
  availableUnless,
  builtInCopyingCommand,
  namingCommand,
  report,
  shellCommand,
  textArgument,
} from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** The media type of an exported profile. */
const PROFILE_MEDIA_TYPE = 'application/json';

/**
 * Dismissing the notice that stored shortcut profiles could not be read, as
 * the status bar's button does, and named as that button is, so the palette
 * and the status bar call one action by one name. Nothing is lost by it: the
 * text that could not be read, where it is not set aside already, is set aside
 * by the first write that finds room for it.
 */
function dismissNoticeCommand(): Command<ShellContext> {
  return shellCommand(
    'shortcuts.dismiss-notice',
    `Dismiss the notice about ${subjectOf('profiles')}`,
    CommandCategory.Settings,
    (context) =>
      report(
        context,
        context.shortcuts.acknowledgeRecovery(),
        `The notice about ${subjectOf('profiles')} is dismissed.`,
      ),
    {
      keywords: ['shortcut', 'profile', 'notice', 'dismiss', 'recovered', 'hide'],
      availability: (context) =>
        context.shortcuts.get().recovery === undefined
          ? unavailable(noNoticeAbout('profiles'))
          : AVAILABLE,
    },
  );
}

/** The commands that change the shortcut profile. */
export function shortcutCommands(): readonly Command<ShellContext>[] {
  return [
    builtInCopyingCommand(
      'shortcuts.rebind',
      'Change a shortcut',
      CommandCategory.Settings,
      (context, invocation) => {
        const target = textArgument(invocation, 'commandId');
        const written = textArgument(invocation, 'shortcut');
        if (target === undefined || written === undefined) {
          return 'Choose a command and a shortcut in the settings.';
        }

        // Checked rather than minted. `commandId` throws on a malformed
        // identifier, and this argument comes from wherever the invocation
        // does: a macro, a replayed journal or an imported profile.
        if (!isCommandId(target)) return `There is no command "${target}".`;

        const value = parseShortcut(written);
        if (!value.ok) return reasonsOf(value.failures);

        // The layout and the combination's name, read once for every answer
        // below, so no two answers can name the combination differently.
        const layout = context.keyboardLayout.get();
        const described = describeShortcut(value.value, context.convention, layout);

        // A refusal first: a binding the browser takes on this keyboard is
        // refused even where it is already the command's, rather than hidden
        // behind "already its shortcut". The refusal itself is `rebind`'s to
        // give, so this only reads whether there is one.
        const { profile } = context.shortcuts.get();
        const already =
          platformReservation(value.value, context.convention, layout) === undefined &&
          profile.bindings.some(
            (binding) =>
              binding.commandId === target &&
              shortcutKey(binding.shortcut) === shortcutKey(value.value),
          );
        if (already) {
          return unchanged('shortcuts.already-bound', `${described} is already its shortcut.`);
        }

        const wasBuiltIn = profile.builtIn;
        const refusal = context.shortcuts.rebind(commandId(target), value.value);

        return report(
          context,
          refusal,
          wasBuiltIn
            ? `${described} is bound, in a copy of the defaults called "${context.shortcuts.get().profile.displayName}".`
            : `${described} is bound.`,
        );
      },
      {
        keywords: ['shortcut', 'key', 'bind', 'remap', 'keyboard'],
        description:
          'Binds a command to a key combination. Choose which in the Shortcuts settings.',
      },
    ),

    builtInCopyingCommand(
      'shortcuts.unbind',
      'Remove a shortcut',
      CommandCategory.Settings,
      (context, invocation) => {
        const target = textArgument(invocation, 'commandId');
        if (target === undefined) {
          return 'Choose a command in the Shortcuts settings.';
        }
        if (!isCommandId(target)) return `There is no command "${target}".`;
        if (!context.shortcuts.get().profile.bindings.some((one) => one.commandId === target)) {
          return unchanged('shortcuts.none-to-remove', 'That command has no shortcut.');
        }

        const refusal = context.shortcuts.unbind(commandId(target));
        return report(context, refusal, 'That command no longer has a shortcut.');
      },
      { keywords: ['shortcut', 'key', 'unbind', 'remove', 'clear'] },
    ),

    shellCommand(
      'shortcuts.reset',
      'Reset shortcuts to the defaults',
      CommandCategory.Settings,
      (context) => {
        context.shortcuts.resetToDefaults();
        context.interaction.announce('The default shortcuts are in force.');
      },
      {
        keywords: ['shortcut', 'reset', 'default', 'restore'],
        description:
          'Puts the shortcuts AudioGubbins ships with back in force. Profiles you made are kept.',
        availability: (context) =>
          context.shortcuts.get().profile.id === DEFAULT_PROFILE_ID
            ? unavailable('The default shortcuts are already in force.')
            : AVAILABLE,
      },
    ),

    shellCommand(
      'shortcuts.switch-to',
      'Use a shortcut profile',
      CommandCategory.Settings,
      (context, invocation) => {
        const target = textArgument(invocation, 'profileId');
        if (target === undefined) {
          return 'Choose a profile in the Shortcuts settings.';
        }

        const refusal = context.shortcuts.switchTo(target);
        return report(
          context,
          refusal,
          `The "${context.shortcuts.get().profile.displayName}" shortcuts are in force.`,
        );
      },
      {
        keywords: ['shortcut', 'profile', 'switch'],
        availability: (context) =>
          context.shortcuts.get().available.length <= 1
            ? unavailable('There is only one shortcut profile.')
            : AVAILABLE,
      },
    ),

    shellCommand(
      'shortcuts.delete',
      'Delete this shortcut profile',
      CommandCategory.Settings,
      (context) => {
        const current = context.shortcuts.get().profile;
        const refusal = context.shortcuts.remove(current.id);
        return report(context, refusal, `"${current.displayName}" is deleted.`);
      },
      {
        keywords: ['shortcut', 'profile', 'delete', 'remove'],
        availability: (context) =>
          availableUnless(context.shortcuts.removalProblem(context.shortcuts.get().profile.id)),
      },
    ),

    shellCommand(
      'shortcuts.export',
      'Export these shortcuts',
      CommandCategory.Settings,
      (context) => {
        const filename = exportFileName(context.shortcuts.get().profile);

        const refusal = context.files.save(
          filename,
          context.shortcuts.exported(),
          PROFILE_MEDIA_TYPE,
        );
        // Said whole, with no cut: every identifier is in the derived shape and
        // within its bound, so the name is one line of letters, marks, digits
        // and hyphens before its ending, and at most 255 bytes.
        return report(context, refusal, `The shortcuts were saved as "${filename}".`);
      },
      {
        keywords: ['shortcut', 'export', 'save', 'share', 'file'],
        description:
          'Saves the shortcuts in force to a file, so you can use them on another machine.',
      },
    ),

    namingCommand(
      'shortcuts.import',
      'Import shortcuts',
      CommandCategory.Settings,
      (context, invocation) => {
        const text = textArgument(invocation, 'text');
        if (text === undefined) {
          return 'Choose a file in the Shortcuts settings.';
        }

        const outcome = context.shortcuts.imported(text);
        if (outcome.kind === 'refused') return outcome.refusal;

        const name = context.shortcuts.get().profile.displayName;

        // A name the file gives that another profile has is numbered, and the
        // name it is given said with the reason, so the reader who finds it in
        // the list knows which of the two is the one they carried in.
        const inForce =
          outcome.namesake === undefined
            ? `The "${name}" shortcuts are in force.`
            : `There is already a profile called "${outcome.namesake}", so the one imported is called "${name}". Its shortcuts are in force.`;

        // What the browser takes is said, not dropped: the binding stays where
        // the user put it, and the Shortcuts settings name each one with its
        // reason. Dropped, a binding would be lost for good on a keyboard
        // layout nothing is known of yet.
        const taken = outcome.reservedCommands.length;
        context.interaction.announce(
          taken === 0
            ? inForce
            : `${inForce} The browser or the system takes ${taken === 1 ? 'one of them' : `${String(taken)} of them`} on this keyboard; the Shortcuts settings say which.`,
          taken > 0,
        );
        return undefined;
      },
      {
        keywords: ['shortcut', 'import', 'load', 'file'],
        description:
          'Reads shortcuts from a file AudioGubbins exported. Choose the file in the Shortcuts settings.',
      },
    ),

    dismissNoticeCommand(),
  ];
}
