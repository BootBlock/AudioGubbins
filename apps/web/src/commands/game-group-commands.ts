/**
 * The commands of the asset groups' forest (ADR-0101, ADR-0013): making,
 * renaming, moving and deleting a group, and choosing the one worked on,
 * which the Inspector then describes and the commands that name no group act
 * on. Each changes the project only through its game commands, as one step
 * one undo reverses; a refusal is the project's own, naming the group by its
 * path, said once. The policy's commands are `game-policy-commands.ts`.
 */

import { CommandCategory, type Command, type CommandInvocation } from '@audiogubbins/commands';
import type { GameAssetGroup, GameAssetGroupId } from '@audiogubbins/game-audio';
import {
  addGroupInvocation,
  moveGroupInvocation,
  removeGroupInvocation,
  renameGroupInvocation,
} from '@audiogubbins/project-commands';
import { quoted } from '@audiogubbins/text';

import { changeGame } from './game-changes.js';
import {
  gameScope,
  groupAvailability,
  groupName,
  targetGroup,
  type GameScope,
} from './game-target.js';
import { sessionAvailability } from './project-access.js';
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

/** The commands of the asset groups' forest. */
export function gameGroupCommands(): readonly Command<ShellContext>[] {
  return [
    newGroupCommand(),
    chooseGroupCommand(),
    renameGroupCommand(),
    moveGroupCommand(),
    deleteGroupCommand(),
  ];
}
