/**
 * Naming an asset group's regions (ADR-0102): each region of the group named
 * by the naming template it resolves to, as one step, the names the region
 * command writes into each region's own name, for the person to read and
 * change. An asset's name is left as it is, and a template that names a
 * file's extension names no region.
 */

import { CommandCategory, unchanged, type Command } from '@audiogubbins/commands';
import {
  memberNames,
  type GroupMember,
  type NamingTemplate,
  type RegionMember,
} from '@audiogubbins/game-audio';
import { setRegionInvocation } from '@audiogubbins/project-commands';
import { counted, quoted } from '@audiogubbins/text';

import { exportClockAt } from '../export/page-export.js';
import { changeGame } from './game-changes.js';
import {
  gameScope,
  groupAvailability,
  groupName,
  namesOf,
  targetGroup,
  type GameScope,
} from './game-target.js';
import { shellCommand } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** The template each region of `members` is named by, and the regions it names. */
function byTemplate(
  scope: GameScope,
  members: readonly GroupMember[],
): {
  readonly named: ReadonlyMap<NamingTemplate, readonly RegionMember[]>;
  readonly unnamed: readonly GroupMember[];
} {
  const named = new Map<NamingTemplate, RegionMember[]>();
  const unnamed: GroupMember[] = [];
  for (const member of members) {
    if (member.kind !== 'region') continue;
    const template = scope.view.member(member).naming.value;
    if (template === undefined) {
      unnamed.push(member);
      continue;
    }
    named.set(template, [...(named.get(template) ?? []), member]);
  }
  return { named, unnamed };
}

function nameMembersCommand(): Command<ShellContext> {
  return shellCommand(
    'game.name-members',
    'Name the group’s regions by its naming template',
    CommandCategory.Edit,
    (context, invocation) => {
      const scope = gameScope(context);
      if (typeof scope === 'string') return scope;
      const group = targetGroup(context, invocation, scope.view);
      if (typeof group === 'string') return group;
      const { project } = scope.state;
      const members = scope.view.membersOf(group.id).map((one) => one.member);
      const { named, unnamed } = byTemplate(scope, members);
      if (unnamed.length > 0) {
        return `${namesOf(project, unnamed)} resolves no naming template; set one on the group or the member.`;
      }
      const clock = exportClockAt(context.clock.now());
      const names = [...named].flatMap(([template, regions]) =>
        memberNames(project, scope.view.game, regions, template, clock),
      );
      const refused = names.flatMap((one) =>
        one.kind === 'refused' ? one.failures.map((failure) => failure.summary) : [],
      );
      const [problem, ...problems] = refused;
      if (problem !== undefined) return [problem, ...problems];
      const [first, ...rest] = names.flatMap((one) => {
        const region = one.kind === 'named' ? project.regions.get(one.member.region) : undefined;
        return region === undefined || one.kind !== 'named' || region.displayName === one.name
          ? []
          : [setRegionInvocation({ ...region, displayName: one.name })];
      });
      if (first === undefined) {
        return unchanged('game.named-already', 'Every region of the group has its name already.');
      }
      changeGame(context, scope, {
        description: `Name the regions of ${quoted(group.name)}`,
        invocations: [first, ...rest],
        said: `Named ${counted(rest.length + 1, 'region', 'regions')} of the group ${groupName(scope.view, group.id)} by its naming template.`,
      });
      return undefined;
    },
    {
      availability: groupAvailability,
      keywords: ['name', 'rename', 'template', 'regions', 'group', 'batch'],
      description:
        "Names each region of the asset group chosen by the naming template it resolves to, as one step; an asset's name is left as it is.",
    },
  );
}

/** The command that names an asset group's regions. */
export function gameNamingCommands(): readonly Command<ShellContext>[] {
  return [nameMembersCommand()];
}
