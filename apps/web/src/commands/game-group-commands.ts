/**
 * The commands of the asset groups' forest and their policy (ADR-0101,
 * ADR-0013): making, renaming, moving and deleting a group, choosing the one
 * worked on, and setting or unsetting a field of its policy, a saved chain or
 * an export preset among the values it is set from.
 *
 * Each changes the project only through its game commands, as one step one
 * undo reverses; a refusal is the project's own, naming the group by its
 * path, said once. A value of the policy is given as the project document
 * writes it, canonical JSON, and read by the project's own reader, so the
 * interface keeps no policy and no second reading of one.
 */

import {
  CommandCategory,
  unchanged,
  type Command,
  type CommandInvocation,
} from '@audiogubbins/commands';
import { copyChain, succeed, type DomainResult, type LibraryEntryId } from '@audiogubbins/domain';
import {
  POLICY_FIELDS,
  type GameAssetGroup,
  type GameAssetGroupId,
  type PolicyField,
  type PolicyValues,
} from '@audiogubbins/game-audio';
import {
  ProjectCommandId,
  addGroupInvocation,
  moveGroupInvocation,
  removeGroupInvocation,
  renameGroupInvocation,
  setGroupPolicyInvocation,
} from '@audiogubbins/project-commands';
import { canonicalJson, writePolicyValue } from '@audiogubbins/project-format';
import { quoted } from '@audiogubbins/text';

import { presetProfile } from './game-profiles.js';
import {
  gameScope,
  groupAvailability,
  groupName,
  targetGroup,
  type GameScope,
} from './game-target.js';
import { POLICY_FIELD_WORDS } from './game-field-words.js';
import { entryArgument, librarySession, usableOf, type LibrarySession } from './library-access.js';
import { sayWhenSettled, sessionAvailability } from './project-access.js';
import { shellCommand, textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** The name a new group takes where none is given: "New group", then "New group 2" and on. */
const NEW_GROUP = 'New group';

/** What two sibling names are compared by, as the project's validator compares them. */
function nameKey(name: string): string {
  return name.normalize('NFC').toLowerCase();
}

/** The first "New group" name none of `siblings` has. */
function freeName(siblings: readonly GameAssetGroup[]): string {
  const taken = new Set(siblings.map((one) => nameKey(one.name)));
  let name = NEW_GROUP;
  for (let number = 2; taken.has(nameKey(name)); number += 1)
    name = `${NEW_GROUP} ${String(number)}`;
  return name;
}

/**
 * Runs `invocations` on the project as one step called `description`, saying
 * `said` once it is made, or the project's reason it was not, and then
 * `applied` where it was.
 */
export function changeGame(
  context: ShellContext,
  scope: Pick<GameScope, 'session'>,
  change: {
    readonly description: string;
    readonly invocations: readonly [CommandInvocation, ...CommandInvocation[]];
    readonly said: string;
    readonly applied?: () => void;
  },
): void {
  const [first, ...rest] = change.invocations;
  const work =
    rest.length === 0
      ? scope.session.run(first)
      : scope.session.runGroup(change.description, [first, ...rest]);
  sayWhenSettled(context, work, (outcome) => {
    if (outcome.kind !== 'applied') return outcome.reason;
    change.applied?.();
    return change.said;
  });
}

/** The policy field the invocation names by `field`, or why it names none. */
export function fieldArgument(
  invocation: CommandInvocation,
): { readonly field: PolicyField } | string {
  const named = textArgument(invocation, 'field');
  const field = POLICY_FIELDS.find((one) => one === named);
  return field === undefined
    ? `Say which part of the policy: ${POLICY_FIELDS.join(', ')}.`
    : { field };
}

/** The group the invocation names by `parent`, or none where it names none; or why it names no group. */
function parentArgument(
  invocation: CommandInvocation,
  scope: GameScope,
): { readonly parent: GameAssetGroupId | undefined } | string {
  const named = textArgument(invocation, 'parent');
  if (named === undefined) return { parent: undefined };
  const parent = [...scope.view.game.groups.keys()].find((id) => id === named);
  return parent === undefined ? 'The project has no such group to put it in.' : { parent };
}

function newGroupCommand(): Command<ShellContext> {
  return shellCommand(
    'game.new-group',
    'New asset group',
    CommandCategory.Edit,
    (context, invocation) => {
      const scope = gameScope(context);
      if (typeof scope === 'string') return scope;
      const placed = parentArgument(invocation, scope);
      if (typeof placed === 'string') return placed;
      const { parent } = placed;
      const name = textArgument(invocation, 'name') ?? freeName(scope.view.childrenOf(parent));
      const group: GameAssetGroup = {
        id: context.ids.next<'GameAssetGroupId'>(),
        name,
        ...(parent === undefined ? {} : { parent }),
        policy: {},
      };
      const inside = parent === undefined ? '' : ` inside ${groupName(scope.view, parent)}`;
      changeGame(context, scope, {
        description: `Add the group ${quoted(name)}`,
        invocations: [addGroupInvocation(group)],
        said: `Made the group ${quoted(name)}${inside}.`,
        applied: () => {
          context.groups.choose(group.id);
        },
      });
      return undefined;
    },
    {
      availability: sessionAvailability,
      keywords: ['group', 'new', 'add', 'folder', 'game', 'asset group'],
      description:
        'Makes an asset group, at the top or inside the group named, whose members inherit its policy.',
    },
  );
}

function chooseGroupCommand(): Command<ShellContext> {
  return shellCommand(
    'game.choose-group',
    'Show an asset group in the Inspector',
    CommandCategory.View,
    (context, invocation) => {
      const scope = gameScope(context);
      if (typeof scope === 'string') return scope;
      const group = targetGroup(context, invocation, scope.view);
      if (typeof group === 'string') return group;
      context.groups.choose(group.id);
      return undefined;
    },
    {
      availability: groupAvailability,
      keywords: ['group', 'inspect', 'policy', 'show', 'choose'],
      discoverable: false,
    },
  );
}

function renameGroupCommand(): Command<ShellContext> {
  return shellCommand(
    'game.rename-group',
    'Rename the asset group',
    CommandCategory.Edit,
    (context, invocation) => {
      const scope = gameScope(context);
      if (typeof scope === 'string') return scope;
      const group = targetGroup(context, invocation, scope.view);
      if (typeof group === 'string') return group;
      const name = textArgument(invocation, 'name');
      if (name === undefined) return 'Give the group a name.';
      changeGame(context, scope, {
        description: `Rename the group ${quoted(group.name)}`,
        invocations: [renameGroupInvocation(group.id, name)],
        said: `Renamed the group ${quoted(group.name)} to ${quoted(name)}.`,
      });
      return undefined;
    },
    { availability: groupAvailability, keywords: ['group', 'rename', 'name'] },
  );
}

function moveGroupCommand(): Command<ShellContext> {
  return shellCommand(
    'game.move-group',
    'Move the asset group',
    CommandCategory.Edit,
    (context, invocation) => {
      const scope = gameScope(context);
      if (typeof scope === 'string') return scope;
      const group = targetGroup(context, invocation, scope.view);
      if (typeof group === 'string') return group;
      const placed = parentArgument(invocation, scope);
      if (typeof placed === 'string') return placed;
      const { parent } = placed;
      const where =
        parent === undefined ? 'to the top level' : `inside ${groupName(scope.view, parent)}`;
      changeGame(context, scope, {
        description: `Move the group ${quoted(group.name)}`,
        invocations: [moveGroupInvocation(group.id, parent)],
        said: `Moved the group ${quoted(group.name)} ${where}. Its members inherit from there now.`,
      });
      return undefined;
    },
    {
      availability: groupAvailability,
      keywords: ['group', 'move', 'parent', 'nest', 'indent'],
      description:
        'Moves an asset group inside the group named, or to the top level where none is named.',
    },
  );
}

function deleteGroupCommand(): Command<ShellContext> {
  return shellCommand(
    'game.delete-group',
    'Delete the asset group',
    CommandCategory.Edit,
    (context, invocation) => {
      const scope = gameScope(context);
      if (typeof scope === 'string') return scope;
      const group = targetGroup(context, invocation, scope.view);
      if (typeof group === 'string') return group;
      const name = groupName(scope.view, group.id);
      changeGame(context, scope, {
        description: `Delete the group ${quoted(group.name)}`,
        invocations: [removeGroupInvocation(group.id)],
        said: `Deleted the group ${name}.`,
        applied: () => {
          if (context.groups.chosen.get()?.group === group.id) context.groups.forget();
        },
      });
      return undefined;
    },
    {
      availability: groupAvailability,
      keywords: ['group', 'delete', 'remove'],
      description:
        'Deletes an asset group that holds no group and no member; take its members out or move its groups first.',
    },
  );
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

/** The commands of the asset groups' forest and their policy. */
export function gameGroupCommands(): readonly Command<ShellContext>[] {
  return [
    newGroupCommand(),
    chooseGroupCommand(),
    renameGroupCommand(),
    moveGroupCommand(),
    deleteGroupCommand(),
    setPolicyCommand(),
    unsetPolicyCommand(),
    applyPresetCommand(),
  ];
}

/**
 * `value` of `field` as the policy commands take it, the project document's
 * own canonical JSON, which the Inspector's editors and the workflows give.
 */
export function policyValueArgument<F extends PolicyField>(
  field: F,
  value: PolicyValues[F],
): string {
  return canonicalJson(writePolicyValue(field, value));
}
