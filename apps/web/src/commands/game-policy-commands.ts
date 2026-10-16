/**
 * The commands of an asset group's policy (ADR-0101, ADR-0102, ADR-0013):
 * setting or unsetting one field, the processing from a saved chain, the
 * built-in game chains among them, copied into the project, and the export
 * profile from an export preset's choices.
 *
 * A value is given as the project document writes it, canonical JSON, and
 * read by the project's own reader, so the interface keeps no policy and no
 * second reading of one; a value it refuses is refused naming the group.
 */

import {
  CommandCategory,
  unchanged,
  type Command,
  type CommandInvocation,
} from '@audiogubbins/commands';
import { copyChain, succeed, type DomainResult, type LibraryEntryId } from '@audiogubbins/domain';
import { POLICY_FIELDS, type GameAssetGroup, type PolicyField } from '@audiogubbins/game-audio';
import { ProjectCommandId, setGroupPolicyInvocation } from '@audiogubbins/project-commands';
import { quoted } from '@audiogubbins/text';

import { changeGame } from './game-changes.js';
import { POLICY_FIELD_WORDS } from './game-field-words.js';
import { presetProfile } from './game-profiles.js';
import {
  gameScope,
  groupAvailability,
  groupName,
  targetGroup,
  type GameScope,
} from './game-target.js';
import { entryArgument, librarySession, usableOf, type LibrarySession } from './library-access.js';
import { sayWhenSettled } from './project-access.js';
import { shellCommand, textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** The policy field the invocation names by `field`, or why it names none. */
function fieldArgument(invocation: CommandInvocation): { readonly field: PolicyField } | string {
  const named = textArgument(invocation, 'field');
  const field = POLICY_FIELDS.find((one) => one === named);
  return field === undefined
    ? `Say which part of the policy: ${POLICY_FIELDS.join(', ')}.`
    : { field };
}

/** Sets `field` of `group` to `value`, given as canonical JSON, the project reading it. */
function setFromValue(
  context: ShellContext,
  scope: GameScope,
  group: GameAssetGroup,
  field: PolicyField,
  value: string,
): void {
  const words = POLICY_FIELD_WORDS[field];
  // The project's own command reads the value by the document's reader and
  // refuses one it does not read, naming the group; nothing reads it twice.
  changeGame(context, scope, {
    description: `Set the ${words} of ${quoted(group.name)}`,
    invocations: [
      {
        commandId: ProjectCommandId.SetGroupPolicy,
        arguments: { group: group.id, field, value },
      },
    ],
    said: `Set the ${words} of the group ${groupName(scope.view, group.id)}. Its members inherit it where they set none of their own.`,
  });
}

/**
 * Copies the saved chain `entry`, one the person keeps or one AudioGubbins
 * comes with, into the project as `group`'s processing, as one step: the
 * group's inheriting members hear it at once (ADR-0101).
 */
async function processingFromLibrary(
  context: ShellContext,
  reached: LibrarySession,
  group: GameAssetGroup,
  entry: LibraryEntryId,
): Promise<DomainResult<string>> {
  const listed = await reached.library.entry(entry);
  if (!listed.ok) return listed;
  const usable = usableOf(listed.value, 'chain');
  if (!usable.ok) return usable;
  const { name, content } = usable.value;
  const copy = copyChain(content.chain, context.ids);
  const ran = await reached.session.runGroup(
    `Set the processing of ${quoted(group.name)} to ${quoted(name)}`,
    [setGroupPolicyInvocation(group.id, 'processing', copy.id, copy)],
  );
  if (!ran.ok) return ran;
  return succeed(
    ran.value.kind === 'applied'
      ? `The group ${quoted(group.name)} processes with a copy of ${quoted(name)} now, which its inheriting members hear.`
      : ran.value.reason,
  );
}

function setPolicyCommand(): Command<ShellContext> {
  return shellCommand(
    'game.set-policy',
    'Set a policy of the asset group',
    CommandCategory.Edit,
    (context, invocation) => {
      const scope = gameScope(context);
      if (typeof scope === 'string') return scope;
      const group = targetGroup(context, invocation, scope.view);
      if (typeof group === 'string') return group;
      const named = fieldArgument(invocation);
      if (typeof named === 'string') return named;
      const { field } = named;
      if (textArgument(invocation, 'entry') !== undefined) {
        if (field !== 'processing') return 'A saved chain sets the processing alone.';
        const entry = entryArgument(invocation);
        if ('refused' in entry) return entry.refused;
        const reached = librarySession(context);
        if (typeof reached === 'string') return reached;
        sayWhenSettled(
          context,
          processingFromLibrary(context, reached, group, entry.id),
          (said) => said,
        );
        return undefined;
      }
      const value = textArgument(invocation, 'value');
      if (value === undefined) {
        return 'Give the value to set, or unset it so the group inherits it.';
      }
      setFromValue(context, scope, group, field, value);
      return undefined;
    },
    {
      availability: groupAvailability,
      keywords: ['group', 'policy', 'set', 'default', 'inherit', 'naming', 'loudness', 'profile'],
      description:
        "Sets one part of an asset group's policy, which its members and groups inherit unless they set their own; the processing may be a saved chain, copied into the project.",
    },
  );
}

function unsetPolicyCommand(): Command<ShellContext> {
  return shellCommand(
    'game.unset-policy',
    'Unset a policy of the asset group',
    CommandCategory.Edit,
    (context, invocation) => {
      const scope = gameScope(context);
      if (typeof scope === 'string') return scope;
      const group = targetGroup(context, invocation, scope.view);
      if (typeof group === 'string') return group;
      const named = fieldArgument(invocation);
      if (typeof named === 'string') return named;
      const words = POLICY_FIELD_WORDS[named.field];
      if (group.policy[named.field] === undefined) {
        return unchanged('game.unset-already', `The group ${quoted(group.name)} sets no ${words}.`);
      }
      changeGame(context, scope, {
        description: `Unset the ${words} of ${quoted(group.name)}`,
        invocations: [setGroupPolicyInvocation(group.id, named.field, undefined)],
        said: `The group ${groupName(scope.view, group.id)} sets no ${words} now; it inherits one where a group above it sets it.`,
      });
      return undefined;
    },
    {
      availability: groupAvailability,
      keywords: ['group', 'policy', 'unset', 'inherit', 'reset', 'clear'],
    },
  );
}

function applyPresetCommand(): Command<ShellContext> {
  return shellCommand(
    'game.apply-preset-to-group',
    'Apply an export preset to the asset group',
    CommandCategory.Edit,
    (context, invocation) => {
      const scope = gameScope(context);
      if (typeof scope === 'string') return scope;
      const group = targetGroup(context, invocation, scope.view);
      if (typeof group === 'string') return group;
      const chosen = presetProfile(context, invocation);
      if (typeof chosen === 'string') return chosen;
      changeGame(context, scope, {
        description: `Set the export profile of ${quoted(group.name)}`,
        invocations: [setGroupPolicyInvocation(group.id, 'exportProfile', chosen.profile)],
        said: `The group ${groupName(scope.view, group.id)} exports as ${quoted(chosen.name)} now, by a copy of its choices that a later change to the preset leaves as it is.`,
      });
      return undefined;
    },
    {
      availability: groupAvailability,
      keywords: ['group', 'export', 'preset', 'profile', 'format'],
      description:
        "Copies an export preset's choices into an asset group's export profile, which its members export by.",
    },
  );
}

/** The commands of an asset group's policy. */
export function gamePolicyCommands(): readonly Command<ShellContext>[] {
  return [setPolicyCommand(), unsetPolicyCommand(), applyPresetCommand()];
}
