/**
 * A member's effective policy, field by field, with where each value comes from
 * (ADR-0101).
 *
 * A field resolves to the member's override where it sets one, else to the
 * nearest group from the member's own up to its root that sets it, else it is
 * unset; each answer names its source (the override, or the group with its
 * path) and the values of the ancestors it hides, nearest first, which is what
 * resetting it would reveal. `processing` resolves over the groups alone: the
 * membership's own record and the member's rack say how the member stands
 * against it. Tags are the one additive field: every ancestor's and the
 * region's own, each with every source that gives it.
 *
 * Resolution reads a state the validator has passed. Each group is resolved
 * once from its parent's answer, so `resolveAll` costs O(groups + members)
 * besides the answers it builds, and an answer depends on the state alone,
 * never on the order of a map or of the memberships of others.
 */

import type { EffectChainId, Project } from '@audiogubbins/domain';

import type { GameAssetGroup } from '../groups/game-asset-group.js';
import type { GameAudioState } from '../groups/game-audio-state.js';
import type { GameAssetGroupId } from '../groups/group-ids.js';
import {
  memberKey,
  type GroupMember,
  type GroupMembership,
  type MemberProcessing,
} from '../groups/membership.js';
import type { PolicyField, PolicyValues } from './policy-fields.js';

export type PolicySource =
  | { readonly kind: 'override'; readonly member: GroupMember }
  | { readonly kind: 'group'; readonly group: GameAssetGroupId; readonly path: readonly string[] }
  | { readonly kind: 'unset' };

/** A value an ancestor sets that a nearer source hides. */
export interface Shadowed<T> {
  readonly group: GameAssetGroupId;
  readonly value: T;
}

export interface Resolved<T> {
  /** `undefined` exactly where the source is `unset`. */
  readonly value: T | undefined;
  readonly source: PolicySource;
  /** Ancestors' values the source hides, nearest first: what a reset would reveal. */
  readonly shadowed: readonly Shadowed<T>[];
}

export type TagSource =
  { readonly kind: 'group'; readonly group: GameAssetGroupId } | { readonly kind: 'member' };

export interface ResolvedTag {
  readonly tag: string;
  /** Every source that gives the tag, nearest first: the member, then its groups up to the root. */
  readonly from: readonly TagSource[];
}

/** Every field but the additive `tags`, resolved. */
type ResolvedFields = {
  readonly [F in Exclude<PolicyField, 'tags'>]: Resolved<PolicyValues[F]>;
};

/** What a group's members inherit, the group's own settings included. */
export interface GroupEffectivePolicy {
  readonly group: GameAssetGroupId;
  readonly fields: ResolvedFields;
  /** Sorted by tag. */
  readonly tags: readonly ResolvedTag[];
}

export interface EffectivePolicy {
  readonly member: GroupMember;
  /** The member's group; `undefined` where it is in none. */
  readonly group: GameAssetGroupId | undefined;
  readonly processing: Resolved<EffectChainId | 'none'> & {
    /** How the member stands against what it inherits; `undefined` where it is in no group. */
    readonly membership: MemberProcessing | undefined;
    /** The chain its rack names, where it has one. */
    readonly rack: EffectChainId | undefined;
  };
  readonly loudness: Resolved<PolicyValues['loudness']>;
  readonly exportProfile: Resolved<PolicyValues['exportProfile']>;
  readonly naming: Resolved<PolicyValues['naming']>;
  readonly destination: Resolved<PolicyValues['destination']>;
  readonly emitter: Resolved<PolicyValues['emitter']>;
  readonly variation: Resolved<PolicyValues['variation']>;
  readonly bus: Resolved<PolicyValues['bus']>;
  /** Sorted by tag. */
  readonly tags: readonly ResolvedTag[];
}

const UNSET: Resolved<never> = { value: undefined, source: { kind: 'unset' }, shadowed: [] };

const NOTHING_INHERITED: ResolvedFields = {
  processing: UNSET,
  loudness: UNSET,
  exportProfile: UNSET,
  naming: UNSET,
  destination: UNSET,
  emitter: UNSET,
  variation: UNSET,
  bus: UNSET,
};

/** What `above` hides once a nearer source sets its field: its value, then what it hid. */
function hiddenBy<T>(above: Resolved<T>): readonly Shadowed<T>[] {
  return above.source.kind === 'group' && above.value !== undefined
    ? [{ group: above.source.group, value: above.value }, ...above.shadowed]
    : [];
}

/** A field as `source` sets it to `value`, over what was resolved above it, or that if it does not. */
function setOver<T>(value: T | undefined, source: PolicySource, above: Resolved<T>): Resolved<T> {
  return value === undefined ? above : { value, source, shadowed: hiddenBy(above) };
}

/** Tags in the order every answer lists them: by code unit, so no locale can change it. */
function byTag(left: ResolvedTag, right: ResolvedTag): number {
  if (left.tag === right.tag) return 0;
  return left.tag < right.tag ? -1 : 1;
}

/** `tags` given by `source`, before the tags resolved above it. */
function tagsOver(
  tags: readonly string[],
  source: TagSource,
  above: readonly ResolvedTag[],
): readonly ResolvedTag[] {
  if (tags.length === 0) return above;
  const own = new Set(tags);
  const fromAbove = new Map(above.map((one) => [one.tag, one.from]));
  const kept = above.filter((one) => !own.has(one.tag));
  const given = [...own].map((tag) => ({ tag, from: [source, ...(fromAbove.get(tag) ?? [])] }));
  return [...kept, ...given].toSorted(byTag);
}

/** One group resolved, with the path its answers name it by. */
interface GroupLevel {
  readonly policy: GroupEffectivePolicy;
  readonly path: readonly string[];
}

function groupLevel(group: GameAssetGroup, above: GroupLevel | undefined): GroupLevel {
  const path = [...(above?.path ?? []), group.name];
  const source: PolicySource = { kind: 'group', group: group.id, path };
  const inherited = above?.policy.fields ?? NOTHING_INHERITED;
  const { policy } = group;
  return {
    path,
    policy: {
      group: group.id,
      fields: {
        processing: setOver(policy.processing, source, inherited.processing),
        loudness: setOver(policy.loudness, source, inherited.loudness),
        exportProfile: setOver(policy.exportProfile, source, inherited.exportProfile),
        naming: setOver(policy.naming, source, inherited.naming),
        destination: setOver(policy.destination, source, inherited.destination),
        emitter: setOver(policy.emitter, source, inherited.emitter),
        variation: setOver(policy.variation, source, inherited.variation),
        bus: setOver(policy.bus, source, inherited.bus),
      },
      tags: tagsOver(
        policy.tags ?? [],
        { kind: 'group', group: group.id },
        above?.policy.tags ?? [],
      ),
    },
  };
}

/**
 * Each group's resolved policy, each resolved once and from its parent's: the
 * one walk of the forest every answer here is made by. Throws on a group the
 * forest does not hold or one that is its own ancestor, which a validated state
 * has neither of.
 */
function groupLevels(state: GameAudioState): (id: GameAssetGroupId) => GroupLevel {
  const resolved = new Map<GameAssetGroupId, GroupLevel>();
  const walking = new Set<GameAssetGroupId>();
  const levelOf = (id: GameAssetGroupId): GroupLevel => {
    const known = resolved.get(id);
    if (known !== undefined) return known;
    const group = state.groups.get(id);
    if (group === undefined) {
      throw new Error(`Group ${id} is not in the forest; only a validated state is resolved.`);
    }
    if (walking.has(id)) {
      throw new Error(`Group ${id} is its own ancestor; only a validated state is resolved.`);
    }
    walking.add(id);
    const level = groupLevel(group, group.parent === undefined ? undefined : levelOf(group.parent));
    walking.delete(id);
    resolved.set(id, level);
    return level;
  };
  return levelOf;
}

function unknownMember(member: GroupMember): Error {
  return new Error(
    `Member ${memberKey(member)} is not in the project; only a validated state is resolved.`,
  );
}

/** The region's or asset's own rack and tags, from the project that holds it. */
function memberOwn(
  project: Project,
  member: GroupMember,
): { readonly rack: EffectChainId | undefined; readonly tags: readonly string[] } {
  if (member.kind === 'region') {
    const region = project.regions.get(member.region);
    if (region === undefined) throw unknownMember(member);
    return { rack: region.rack, tags: region.tags };
  }
  const asset = project.assets.get(member.asset);
  if (asset === undefined) throw unknownMember(member);
  // An asset has no tags of its own in this phase.
  return { rack: asset.rack, tags: [] };
}

/** A field as the member's override sets it, over what its group resolves. */
function overridden<T>(
  value: T | undefined,
  membership: GroupMembership,
  inherited: Resolved<T>,
): Resolved<T> {
  return setOver(value, { kind: 'override', member: membership.member }, inherited);
}

function memberPolicy(
  project: Project,
  member: GroupMember,
  membership: GroupMembership | undefined,
  level: GroupLevel | undefined,
): EffectivePolicy {
  const own = memberOwn(project, member);
  const memberTags = tagsOver(own.tags, { kind: 'member' }, level?.policy.tags ?? []);
  if (membership === undefined || level === undefined) {
    return {
      member,
      group: undefined,
      ...NOTHING_INHERITED,
      processing: { ...UNSET, membership: undefined, rack: own.rack },
      tags: memberTags,
    };
  }
  const { fields } = level.policy;
  const { overrides } = membership;
  return {
    member,
    group: membership.group,
    processing: { ...fields.processing, membership: membership.processing, rack: own.rack },
    loudness: overridden(overrides.loudness, membership, fields.loudness),
    exportProfile: overridden(overrides.exportProfile, membership, fields.exportProfile),
    naming: overridden(overrides.naming, membership, fields.naming),
    destination: overridden(overrides.destination, membership, fields.destination),
    emitter: fields.emitter,
    variation: overridden(overrides.variation, membership, fields.variation),
    bus: overridden(overrides.bus, membership, fields.bus),
    tags: memberTags,
  };
}

/** The membership of `member` in `state`, where it has one. */
export function membershipOf(
  state: GameAudioState,
  member: GroupMember,
): GroupMembership | undefined {
  const key = memberKey(member);
  return state.memberships.find((one) => memberKey(one.member) === key);
}

/**
 * Each group's resolved policy, by a resolver that resolves each group once
 * however many times it is asked: for a pass over many members or groups.
 */
export function groupPolicies(
  state: GameAudioState,
): (id: GameAssetGroupId) => GroupEffectivePolicy {
  const levelOf = groupLevels(state);
  return (id) => levelOf(id).policy;
}

/** What `group`'s members inherit, the group's own settings included. */
export function resolveGroupPolicy(
  state: GameAudioState,
  group: GameAssetGroupId,
): GroupEffectivePolicy {
  return groupPolicies(state)(group);
}

/** `member`'s effective policy; a member in no group has every field unset and its own tags. */
export function resolvePolicy(
  project: Project,
  state: GameAudioState,
  member: GroupMember,
): EffectivePolicy {
  const membership = membershipOf(state, member);
  const level = membership === undefined ? undefined : groupLevels(state)(membership.group);
  return memberPolicy(project, member, membership, level);
}

/** Every member's effective policy, by `memberKey`, in membership order. */
export function resolveAll(
  project: Project,
  state: GameAudioState,
): ReadonlyMap<string, EffectivePolicy> {
  const levelOf = groupLevels(state);
  return new Map(
    state.memberships.map((membership) => [
      memberKey(membership.member),
      memberPolicy(project, membership.member, membership, levelOf(membership.group)),
    ]),
  );
}
