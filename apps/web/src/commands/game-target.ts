/**
 * What the game commands act on (ADR-0101): the asset group an invocation
 * names by `group`, or the one chosen in the Asset groups panel; and the
 * members it names by `member`, as `region:<identifier>` or
 * `asset:<identifier>` separated by commas, or else the regions selected in
 * the editor in use, or the region or asset it shows. One rule for the
 * commands, the panel and the Inspector, so a control acts on what it is
 * drawn beside.
 *
 * A game command changes the project only through its game commands, run on
 * its session as one step; it reads the project state the session holds, and
 * the policy as `game-policy-view.ts` resolves it, never a copy of its own.
 */

import {
  AVAILABLE,
  unavailable,
  type CommandAvailability,
  type CommandInvocation,
} from '@audiogubbins/commands';
import { isWellFormedId, unsafeBrandId, type Project } from '@audiogubbins/domain';
import {
  pathText,
  type GameAssetGroup,
  type GameAssetGroupId,
  type GroupMember,
} from '@audiogubbins/game-audio';
import type { ProjectState } from '@audiogubbins/project-format';
import type { RemoteProjectSession } from '@audiogubbins/storage-runtime';
import { counted, quoted } from '@audiogubbins/text';

import { gamePolicyView, type GamePolicyView } from '../state/game-policy-view.js';
import { focusedEditor } from './editor-target.js';
import { sessionAvailability, sessionOf } from './project-access.js';
import { foundRegions } from './region-target.js';
import { textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** The open project a game command changes, as it stands, and its groups. */
export interface GameScope {
  readonly session: RemoteProjectSession;
  readonly state: ProjectState;
  readonly view: GamePolicyView;
}

/** The project open to change and its groups, or why none is. */
export function gameScope(context: ShellContext): GameScope | string {
  const session = sessionOf(context);
  if (typeof session === 'string') return session;
  const { state } = session.getSnapshot().model;
  return { session, state, view: gamePolicyView(state) };
}

/** A group's path as a person reads it, quoted. */
export function groupName(view: GamePolicyView, group: GameAssetGroupId): string {
  return quoted(pathText(view.pathOf(group)));
}

/** The group chosen in the Asset groups panel, where it is still in the project. */
function chosenGroup(context: ShellContext, view: GamePolicyView): GameAssetGroup | undefined {
  const chosen = context.groups.chosen.get();
  return chosen === undefined ? undefined : view.game.groups.get(chosen.group);
}

/** The group the invocation names by `group`, or the one chosen; or why there is none. */
export function targetGroup(
  context: ShellContext,
  invocation: CommandInvocation,
  view: GamePolicyView,
): GameAssetGroup | string {
  const named = textArgument(invocation, 'group');
  if (named === undefined) {
    return chosenGroup(context, view) ?? 'Choose a group in the Asset groups panel first.';
  }
  const group = isWellFormedId(named)
    ? view.game.groups.get(unsafeBrandId<'GameAssetGroupId'>(named))
    : undefined;
  return group ?? 'The project has no such group.';
}

/** Available where a project is open to change and a group is named or chosen. */
export function groupAvailability(context: ShellContext): CommandAvailability {
  const open = sessionAvailability(context);
  if (!open.available) return open;
  const scope = gameScope(context);
  if (typeof scope === 'string') return unavailable(scope);
  return chosenGroup(context, scope.view) === undefined
    ? unavailable('Choose a group in the Asset groups panel first.')
    : AVAILABLE;
}

/** The member `text` names as `region:<identifier>` or `asset:<identifier>`, where it is one of `project`'s. */
function namedMember(project: Project, text: string): GroupMember | undefined {
  const [kind, id = ''] = text.trim().split(':');
  if (!isWellFormedId(id)) return undefined;
  if (kind === 'region') {
    const region = unsafeBrandId<'RegionId'>(id);
    return project.regions.has(region) ? { kind: 'region', region } : undefined;
  }
  if (kind === 'asset') {
    const asset = unsafeBrandId<'AssetId'>(id);
    return project.assets.has(asset) ? { kind: 'asset', asset } : undefined;
  }
  return undefined;
}

/** How a member is named in an argument: `region:<identifier>` or `asset:<identifier>`. */
export function memberArgument(member: GroupMember): string {
  return member.kind === 'region' ? `region:${member.region}` : `asset:${member.asset}`;
}

/** What a member is called in a sentence, quoted, or a phrase for one no longer in the project. */
export function memberName(project: Project, member: GroupMember): string {
  const name =
    member.kind === 'region'
      ? project.regions.get(member.region)?.displayName
      : project.assets.get(member.asset)?.displayName;
  return name === undefined ? `a ${member.kind} no longer in the project` : quoted(name);
}

/** The names of `members`, as a list a sentence reads. */
export function namesOf(project: Project, members: readonly GroupMember[]): string {
  const [only, ...rest] = members;
  if (only !== undefined && rest.length === 0) return memberName(project, only);
  return counted(members.length, 'member', 'members');
}

/** The region or asset the editor in use shows, or the regions selected there; or why none. */
function membersInView(
  context: ShellContext,
  invocation: CommandInvocation,
): readonly [GroupMember, ...GroupMember[]] | string {
  const regions = foundRegions(context, invocation);
  if (typeof regions !== 'string') {
    const [first, ...rest] = regions;
    return [
      { kind: 'region', region: first.region.id },
      ...rest.map((one): GroupMember => ({ kind: 'region', region: one.region.id })),
    ];
  }
  const view = focusedEditor(context);
  if (typeof view === 'string') return view;
  const { owner } = view.asset;
  if (owner.kind !== 'project') return owner.reason;
  return owner.region === undefined
    ? [{ kind: 'asset', asset: owner.asset.id }]
    : [{ kind: 'region', region: owner.region.id }];
}

/** The members the invocation names by `member`, or those of the editor in use; or why none. */
export function targetMembers(
  context: ShellContext,
  invocation: CommandInvocation,
  project: Project,
): readonly [GroupMember, ...GroupMember[]] | string {
  const named = textArgument(invocation, 'member');
  if (named === undefined) return membersInView(context, invocation);
  const members: GroupMember[] = [];
  for (const text of named.split(',')) {
    const member = namedMember(project, text);
    if (member === undefined) return 'The project has no such region or asset.';
    members.push(member);
  }
  const [first, ...rest] = members;
  return first === undefined ? 'Say which region or asset.' : [first, ...rest];
}

/** The one member the invocation names or the editor in use shows, or why there is not one. */
export function targetMember(
  context: ShellContext,
  invocation: CommandInvocation,
  project: Project,
): GroupMember | string {
  const members = targetMembers(context, invocation, project);
  if (typeof members === 'string') return members;
  return members.length === 1 ? members[0] : 'Choose one region or asset for this.';
}
