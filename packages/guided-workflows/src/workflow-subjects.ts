/**
 * What a workflow plans over (ADR-0105): its targets expanded to members and
 * groups, and each member as it stands in the project, with its audio's
 * place on its asset's edited timeline.
 *
 * A group's members come in membership order, the order `{number}` counts by,
 * then its subgroups' depth first in name order where asked; each member once,
 * at its first place, so a target listed twice is planned once.
 */

import {
  FailureKind,
  anchorResolver,
  fail,
  failure,
  placeRegion,
  shapesOf,
  succeed,
  type Asset,
  type DomainResult,
  type Region,
  type SampleRate,
  type Span,
} from '@audiogubbins/domain';
import {
  memberKey,
  type GameAssetGroupId,
  type GameAudioState,
  type GroupMember,
  type GroupMembership,
} from '@audiogubbins/game-audio';
import type { RackTarget } from '@audiogubbins/project-commands';
import type { ProjectState } from '@audiogubbins/project-format';

import type { WorkflowTarget } from './guided-workflow.js';

/** The game-audio state of a project with no groups. */
const NO_GROUPS: GameAudioState = { groups: new Map(), memberships: [] };

/** `state`'s game-audio state, empty where it has none. */
export function gameOf(state: ProjectState): GameAudioState {
  return state.gameAudio ?? NO_GROUPS;
}

/** Siblings in name order, by code unit, which no locale changes. */
function byName(left: { readonly name: string }, right: { readonly name: string }): number {
  if (left.name === right.name) return 0;
  return left.name < right.name ? -1 : 1;
}

/** `group` and, where `subgroups` asks, every group inside it, depth first in name order. */
export function expandedGroups(
  state: GameAudioState,
  group: GameAssetGroupId,
  subgroups: boolean,
): readonly GameAssetGroupId[] {
  if (!state.groups.has(group)) return [];
  if (!subgroups) return [group];
  const children = [...state.groups.values()]
    .filter((one) => one.parent === group)
    .toSorted(byName);
  return [group, ...children.flatMap((child) => expandedGroups(state, child.id, true))];
}

/**
 * A target list expanded to members: a group's members in membership order,
 * then its subgroups' depth first in name order where asked; each member once,
 * at its first place. A group the state does not hold has no members.
 */
export function targetMembers(
  state: GameAudioState,
  targets: readonly WorkflowTarget[],
): readonly GroupMember[] {
  const seen = new Set<string>();
  const members: GroupMember[] = [];
  const add = (member: GroupMember): void => {
    const key = memberKey(member);
    if (seen.has(key)) return;
    seen.add(key);
    members.push(member);
  };
  for (const target of targets) {
    if (target.kind !== 'group') {
      add(target);
      continue;
    }
    for (const group of expandedGroups(state, target.group, target.subgroups)) {
      for (const membership of state.memberships) {
        if (membership.group === group) add(membership.member);
      }
    }
  }
  return members;
}

/** The group targets `state` does not hold, which no plan can be made over. */
function unknownGroupTargets(
  state: GameAudioState,
  targets: readonly WorkflowTarget[],
): readonly GameAssetGroupId[] {
  return targets.flatMap((target) =>
    target.kind === 'group' && !state.groups.has(target.group) ? [target.group] : [],
  );
}

/** Why no plan is made over `targets` in `state`, or `undefined` where one can be. */
export function targetsProblem(
  state: GameAudioState,
  targets: readonly WorkflowTarget[],
): DomainResult<never> | undefined {
  const [unknown, ...others] = unknownGroupTargets(state, targets).map((group) =>
    failure(
      'workflow.group-unknown',
      FailureKind.Rejected,
      'A group the workflow was asked to run over is no longer in the project.',
      { details: { group } },
    ),
  );
  if (unknown !== undefined) return fail(unknown, ...others);
  if (targets.length === 0) {
    return fail(
      failure(
        'workflow.no-targets',
        FailureKind.Rejected,
        'Choose the sounds or groups to run the workflow over.',
      ),
    );
  }
  return undefined;
}

/** `member`'s membership in `state`, where it is in a group. */
export function membershipOf(
  state: GameAudioState,
  member: GroupMember,
): GroupMembership | undefined {
  const key = memberKey(member);
  return state.memberships.find((one) => memberKey(one.member) === key);
}

/** A member as it stands in the project. */
export interface MemberSubject {
  readonly member: GroupMember;
  readonly asset: Asset;
  /** The region, where the member is one. */
  readonly region: Region | undefined;
  /** Where the member's audio lies on its asset's edited timeline now. */
  readonly span: Span;
  /** The asset's rate as its edits leave it, at which the member's frames are counted. */
  readonly sampleRate: SampleRate;
  /** What the person calls it. */
  readonly name: string;
  readonly rack: RackTarget;
  readonly membership: GroupMembership | undefined;
}

function unknownMember(member: GroupMember): DomainResult<never> {
  return fail(
    failure(
      'workflow.member-unknown',
      FailureKind.Rejected,
      `The project no longer has this ${member.kind}.`,
      { details: { member: memberKey(member) } },
    ),
  );
}

/** `member` as it stands in `state`, or why the workflow cannot reach it. */
export function memberSubject(
  state: ProjectState,
  member: GroupMember,
): DomainResult<MemberSubject> {
  const { project } = state;
  const membership = membershipOf(gameOf(state), member);
  if (member.kind === 'asset') {
    const asset = project.assets.get(member.asset);
    if (asset === undefined) return unknownMember(member);
    const shape = shapesOf(asset).at(-1);
    return succeed({
      member,
      asset,
      region: undefined,
      span: { start: 0, end: shape?.length ?? asset.length },
      sampleRate: shape?.sampleRate ?? asset.sampleRate,
      name: asset.displayName,
      rack: { kind: 'asset', asset },
      membership,
    });
  }
  const region = project.regions.get(member.region);
  const asset = region === undefined ? undefined : project.assets.get(region.assetId);
  if (region === undefined || asset === undefined) return unknownMember(member);
  const placed = placeRegion(anchorResolver(asset), region);
  if (placed === undefined || placed.length === 0) {
    return fail(
      failure(
        'workflow.region-empty',
        FailureKind.Rejected,
        `The region "${region.displayName}" no longer holds any audio: the edits since it was made took it out.`,
        { details: { member: memberKey(member) } },
      ),
    );
  }
  return succeed({
    member,
    asset,
    region,
    span: { start: placed.start, end: placed.start + placed.length },
    sampleRate: shapesOf(asset).at(-1)?.sampleRate ?? asset.sampleRate,
    name: region.displayName,
    rack: { kind: 'region', region, asset },
    membership,
  });
}

/** How many frames `span` covers. */
export function spanLength(span: Span): number {
  return span.end - span.start;
}
