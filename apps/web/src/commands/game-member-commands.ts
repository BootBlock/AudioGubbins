/**
 * The commands of an asset group's members (ADR-0101, ADR-0013): putting the
 * regions or assets of the editor in use in a group and taking them out,
 * setting and resetting what a member sets over its group, choosing whether it
 * inherits its group's processing, and naming the regions of a group by the
 * naming template each resolves to.
 *
 * A member joins inheriting its group's processing where it has no rack of
 * its own, and owning its processing where it has one, so joining never takes
 * away processing the person made; either is changed after by the command of
 * its name. Each change is the project's own game commands as one step.
 */

import {
  CommandCategory,
  unchanged,
  type Command,
  type CommandInvocation,
} from '@audiogubbins/commands';
import type { Project } from '@audiogubbins/domain';
import {
  memberNames,
  type GroupMember,
  type MemberProcessing,
  type NamingTemplate,
  type OverridableField,
  type RegionMember,
} from '@audiogubbins/game-audio';
import {
  ProjectCommandId,
  assignMemberInvocation,
  resetMemberOverrideInvocation,
  setMemberProcessingInvocation,
  setRegionInvocation,
  unassignMemberInvocation,
} from '@audiogubbins/project-commands';
import { canonicalJson, writeGroupMember } from '@audiogubbins/project-format';
import { counted, quoted } from '@audiogubbins/text';

import { exportClockAt } from '../export/page-export.js';
import { OVERRIDABLE_FIELDS, POLICY_FIELD_WORDS } from './game-field-words.js';
import { changeGame } from './game-group-commands.js';
import {
  gameScope,
  groupAvailability,
  groupName,
  memberName,
  targetGroup,
  targetMember,
  targetMembers,
  type GameScope,
} from './game-target.js';
import { sessionAvailability } from './project-access.js';
import { shellCommand, textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** The rack `member` has in `project`, or `undefined` where it has none. */
function rackOf(project: Project, member: GroupMember) {
  return member.kind === 'region'
    ? project.regions.get(member.region)?.rack
    : project.assets.get(member.asset)?.rack;
}

/** The processing the invocation names by `processing`, or none where it names none; or why it is not one. */
function processingArgument(
  invocation: CommandInvocation,
): { readonly processing: MemberProcessing | undefined } | string {
  const named = textArgument(invocation, 'processing');
  if (named === undefined) return { processing: undefined };
  return named === 'inherit' || named === 'own'
    ? { processing: named }
    : 'A member inherits its group’s processing, or owns its own.';
}

/** The names of `members`, as a list a sentence reads. */
function namesOf(project: Project, members: readonly GroupMember[]): string {
  const [only, ...rest] = members;
  if (only !== undefined && rest.length === 0) return memberName(project, only);
  return counted(members.length, 'member', 'members');
}

function assignCommand(): Command<ShellContext> {
  return shellCommand(
    'game.assign-selection',
    'Put the selection in the asset group',
    CommandCategory.Edit,
    (context, invocation) => {
      const scope = gameScope(context);
      if (typeof scope === 'string') return scope;
      const group = targetGroup(context, invocation, scope.view);
      if (typeof group === 'string') return group;
      const { project } = scope.state;
      const members = targetMembers(context, invocation, project);
      if (typeof members === 'string') return members;
      const asked = processingArgument(invocation);
      if (typeof asked === 'string') return asked;
      const joining = (member: GroupMember): CommandInvocation =>
        assignMemberInvocation(
          member,
          group.id,
          asked.processing ?? (rackOf(project, member) === undefined ? 'inherit' : 'own'),
        );
      const [first, ...rest] = members;
      const into = groupName(scope.view, group.id);
      changeGame(context, scope, {
        description: `Put ${counted(members.length, 'member', 'members')} in ${quoted(group.name)}`,
        invocations: [joining(first), ...rest.map(joining)],
        said: `Put ${namesOf(project, members)} in the group ${into}. A member with a rack of its own keeps it; one with none hears the group’s processing.`,
      });
      return undefined;
    },
    {
      availability: groupAvailability,
      keywords: ['group', 'assign', 'add', 'member', 'put', 'region', 'asset'],
      description:
        'Puts the regions selected, or the region or asset shown, in the asset group chosen, from any group they were in.',
    },
  );
}

function removeFromGroupCommand(): Command<ShellContext> {
  return shellCommand(
    'game.remove-from-group',
    'Take out of its asset group',
    CommandCategory.Edit,
    (context, invocation) => {
      const scope = gameScope(context);
      if (typeof scope === 'string') return scope;
      const { project } = scope.state;
      const members = targetMembers(context, invocation, project);
      if (typeof members === 'string') return members;
      const inGroups = members.filter((member) => scope.view.membershipOf(member) !== undefined);
      const [first, ...rest] = inGroups.map((member) => unassignMemberInvocation(member));
      if (first === undefined) {
        return unchanged('game.not-in-group', `${namesOf(project, members)} is in no group.`);
      }
      changeGame(context, scope, {
        description: `Take ${counted(inGroups.length, 'member', 'members')} out of their groups`,
        invocations: [first, ...rest],
        said: `Took ${namesOf(project, inGroups)} out of the group. A rack it has stays as it is.`,
      });
      return undefined;
    },
    {
      availability: sessionAvailability,
      keywords: ['group', 'remove', 'unassign', 'member', 'leave'],
    },
  );
}

/** The overridable field the invocation names by `field`, or why it names none. */
function overridableArgument(
  invocation: CommandInvocation,
): { readonly field: OverridableField } | string {
  const named = textArgument(invocation, 'field');
  const field = OVERRIDABLE_FIELDS.find((one) => one === named);
  return field === undefined
    ? `A member sets its own ${OVERRIDABLE_FIELDS.map((one) => POLICY_FIELD_WORDS[one]).join(', ')}; its processing has a command of its own.`
    : { field };
}

/** The member the invocation names, in a group, with its name; or why there is none. */
function groupedMember(
  context: ShellContext,
  invocation: CommandInvocation,
  scope: GameScope,
): { readonly member: GroupMember; readonly name: string } | string {
  const member = targetMember(context, invocation, scope.state.project);
  if (typeof member === 'string') return member;
  const name = memberName(scope.state.project, member);
  return scope.view.membershipOf(member) === undefined
    ? `${name} is in no group; put it in one first.`
    : { member, name };
}

function setOverrideCommand(): Command<ShellContext> {
  return shellCommand(
    'game.set-override',
    'Override a policy on this member',
    CommandCategory.Edit,
    (context, invocation) => {
      const scope = gameScope(context);
      if (typeof scope === 'string') return scope;
      const found = groupedMember(context, invocation, scope);
      if (typeof found === 'string') return found;
      const named = overridableArgument(invocation);
      if (typeof named === 'string') return named;
      const value = textArgument(invocation, 'value');
      if (value === undefined) return 'Give the value it sets over its group.';
      const words = POLICY_FIELD_WORDS[named.field];
      // The project's own command reads the value by the document's reader.
      changeGame(context, scope, {
        description: `Override the ${words} of ${found.name}`,
        invocations: [
          {
            commandId: ProjectCommandId.SetMemberOverride,
            arguments: {
              member: canonicalJson(writeGroupMember(found.member)),
              field: named.field,
              value,
            },
          },
        ],
        said: `${found.name} sets its own ${words} now, over its group’s.`,
      });
      return undefined;
    },
    {
      availability: sessionAvailability,
      keywords: ['override', 'member', 'policy', 'own', 'naming', 'loudness'],
      discoverable: false,
    },
  );
}

function resetOverrideCommand(): Command<ShellContext> {
  return shellCommand(
    'game.reset-override',
    'Reset a policy of this member to inherited',
    CommandCategory.Edit,
    (context, invocation) => {
      const scope = gameScope(context);
      if (typeof scope === 'string') return scope;
      const found = groupedMember(context, invocation, scope);
      if (typeof found === 'string') return found;
      const named = overridableArgument(invocation);
      if (typeof named === 'string') return named;
      const words = POLICY_FIELD_WORDS[named.field];
      if (scope.view.membershipOf(found.member)?.overrides[named.field] === undefined) {
        return unchanged('game.inherits-already', `${found.name} inherits its ${words} already.`);
      }
      changeGame(context, scope, {
        description: `Reset the ${words} of ${found.name}`,
        invocations: [resetMemberOverrideInvocation(found.member, named.field)],
        said: `${found.name} inherits its ${words} from its group again.`,
      });
      return undefined;
    },
    {
      availability: sessionAvailability,
      keywords: ['reset', 'inherit', 'override', 'member', 'policy'],
    },
  );
}

function resetAllOverridesCommand(): Command<ShellContext> {
  return shellCommand(
    'game.reset-all-overrides',
    'Reset every policy of this member to inherited',
    CommandCategory.Edit,
    (context, invocation) => {
      const scope = gameScope(context);
      if (typeof scope === 'string') return scope;
      const found = groupedMember(context, invocation, scope);
      if (typeof found === 'string') return found;
      const overrides = scope.view.membershipOf(found.member)?.overrides ?? {};
      const [first, ...rest] = OVERRIDABLE_FIELDS.filter(
        (field) => overrides[field] !== undefined,
      ).map((field) => resetMemberOverrideInvocation(found.member, field));
      if (first === undefined) {
        return unchanged('game.inherits-already', `${found.name} sets nothing over its group.`);
      }
      changeGame(context, scope, {
        description: `Reset every override of ${found.name}`,
        invocations: [first, ...rest],
        said: `${found.name} inherits all of its policy from its group again.`,
      });
      return undefined;
    },
    {
      availability: sessionAvailability,
      keywords: ['reset', 'inherit', 'override', 'member', 'policy', 'all'],
    },
  );
}

/** The command that makes a member inherit its group's processing, or own its own. */
function processingCommand(processing: MemberProcessing): Command<ShellContext> {
  const inherit = processing === 'inherit';
  return shellCommand(
    inherit ? 'game.inherit-processing' : 'game.own-processing',
    inherit ? 'Inherit the group’s processing' : 'Keep processing of its own',
    CommandCategory.Edit,
    (context, invocation) => {
      const scope = gameScope(context);
      if (typeof scope === 'string') return scope;
      const found = groupedMember(context, invocation, scope);
      if (typeof found === 'string') return found;
      if (scope.view.membershipOf(found.member)?.processing === processing) {
        return unchanged(
          'game.processing-already',
          inherit
            ? `${found.name} inherits its group’s processing already.`
            : `${found.name} owns its processing already.`,
        );
      }
      changeGame(context, scope, {
        description: inherit
          ? `Make ${found.name} inherit its group’s processing`
          : `Make ${found.name} own its processing`,
        invocations: [setMemberProcessingInvocation(found.member, processing)],
        said: inherit
          ? `${found.name} hears its group’s processing now, its rack the group’s chain, or none where the group sets none.`
          : `${found.name} keeps its rack as its own now; a change to its group’s processing no longer reaches it.`,
      });
      return undefined;
    },
    {
      availability: sessionAvailability,
      keywords: inherit
        ? ['inherit', 'processing', 'rack', 'reset', 'group', 'member']
        : ['own', 'processing', 'rack', 'independent', 'group', 'member'],
    },
  );
}

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

/** The commands of an asset group's members. */
export function gameMemberCommands(): readonly Command<ShellContext>[] {
  return [
    assignCommand(),
    removeFromGroupCommand(),
    setOverrideCommand(),
    resetOverrideCommand(),
    resetAllOverridesCommand(),
    processingCommand('inherit'),
    processingCommand('own'),
    nameMembersCommand(),
  ];
}
