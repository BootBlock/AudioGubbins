import { describe, expect, it } from 'vitest';

import type { Project } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import type { GameAssetGroup } from '../groups/game-asset-group.js';
import type { GameAudioState } from '../groups/game-audio-state.js';
import { memberKey, type GroupMember, type GroupMembership } from '../groups/membership.js';
import { validateGameAudioState } from '../groups/state-validation.js';
import { randomGameWorld, seededRandom, type Random } from '../testing/random-game-state.js';
import { withOverride, withPolicyField, type OverridableField } from './inherited-policy.js';
import { POLICY_FIELDS, type PolicyField } from './policy-fields.js';
import {
  resolveAll,
  resolvePolicy,
  type PolicySource,
  type Resolved,
  type ResolvedTag,
} from './policy-resolution.js';

/** Enough worlds to reach deep forests, members of both kinds and every field set and unset. */
const SEEDS = Array.from({ length: 150 }, (_, index) => index + 1);

const RESOLVED_FIELDS = POLICY_FIELDS.filter(
  (field): field is Exclude<PolicyField, 'tags'> => field !== 'tags',
);
const OVERRIDABLE: readonly OverridableField[] = [
  'loudness',
  'exportProfile',
  'naming',
  'destination',
  'variation',
  'bus',
];

function isOverridable(field: PolicyField): field is OverridableField {
  return (OVERRIDABLE as readonly string[]).includes(field);
}

/** A field of `policy`, read by name, as the oracle reads every field alike. */
function fieldOf(policy: object, field: string): unknown {
  return (policy as Record<string, unknown>)[field];
}

/** The member's group and its ancestors, nearest first, by following parent links. */
function lineOf(state: GameAudioState, membership: GroupMembership): readonly GameAssetGroup[] {
  const line: GameAssetGroup[] = [];
  for (
    let group = state.groups.get(membership.group);
    group !== undefined;
    group = group.parent === undefined ? undefined : state.groups.get(group.parent)
  ) {
    line.push(group);
  }
  return line;
}

/** What a field should resolve to, by the rule stated in ADR-0101, walked apart from the resolver. */
function expected(
  state: GameAudioState,
  member: GroupMember,
  field: Exclude<PolicyField, 'tags'>,
): Resolved<unknown> {
  const membership = state.memberships.find((one) => memberKey(one.member) === memberKey(member));
  if (membership === undefined)
    return { value: undefined, source: { kind: 'unset' }, shadowed: [] };
  const line = lineOf(state, membership);
  const setters = line.filter((group) => fieldOf(group.policy, field) !== undefined);
  const hidden = (groups: readonly GameAssetGroup[]) =>
    groups.map((group) => ({ group: group.id, value: fieldOf(group.policy, field) }));
  const override = isOverridable(field) ? fieldOf(membership.overrides, field) : undefined;
  if (override !== undefined) {
    return { value: override, source: { kind: 'override', member }, shadowed: hidden(setters) };
  }
  const [nearest, ...further] = setters;
  if (nearest === undefined) return { value: undefined, source: { kind: 'unset' }, shadowed: [] };
  const path = line
    .slice(line.indexOf(nearest))
    .map((group) => group.name)
    .reverse();
  const source: PolicySource = { kind: 'group', group: nearest.id, path };
  return { value: fieldOf(nearest.policy, field), source, shadowed: hidden(further) };
}

/** The tags a member should have: its region's, then each group's up to the root, sorted, with every source. */
function expectedTags(
  project: Project,
  state: GameAudioState,
  member: GroupMember,
): readonly ResolvedTag[] {
  const sources = new Map<string, ResolvedTag['from'][number][]>();
  const add = (tag: string, from: ResolvedTag['from'][number]): void => {
    const known = sources.get(tag) ?? [];
    if (!known.some((one) => JSON.stringify(one) === JSON.stringify(from))) known.push(from);
    sources.set(tag, known);
  };
  if (member.kind === 'region') {
    for (const tag of project.regions.get(member.region)?.tags ?? []) add(tag, { kind: 'member' });
  }
  const membership = state.memberships.find((one) => memberKey(one.member) === memberKey(member));
  for (const group of membership === undefined ? [] : lineOf(state, membership)) {
    for (const tag of group.policy.tags ?? []) add(tag, { kind: 'group', group: group.id });
  }
  return [...sources]
    .map(([tag, from]) => ({ tag, from }))
    .toSorted((left, right) => (left.tag < right.tag ? -1 : left.tag > right.tag ? 1 : 0));
}

function shuffled<T>(random: Random, items: readonly T[]): readonly T[] {
  return items
    .map((item) => ({ item, order: random.next() }))
    .toSorted((left, right) => left.order - right.order)
    .map(({ item }) => item);
}

function members(state: GameAudioState): readonly GroupMember[] {
  return state.memberships.map((one) => one.member);
}

/** `state` with `membership`'s overrides replaced. */
function withOverrides(
  state: GameAudioState,
  membership: GroupMembership,
  overrides: GroupMembership['overrides'],
): GameAudioState {
  return {
    ...state,
    memberships: state.memberships.map((one) => (one === membership ? { ...one, overrides } : one)),
  };
}

describe('policy resolution over random forests (REQ-GAME-120)', () => {
  it('is made over worlds the validator passes', () => {
    for (const seed of SEEDS) {
      const { project, state } = randomGameWorld(seed);
      expectSuccess(validateGameAudioState(project, state));
    }
  });

  it('answers every field as the rule does: the override, else the nearest group that sets it, with what each hides', () => {
    for (const seed of SEEDS) {
      const { project, state } = randomGameWorld(seed);
      for (const member of members(state)) {
        const policy = resolvePolicy(project, state, member);
        for (const field of RESOLVED_FIELDS) {
          const { value, source, shadowed } = policy[field];
          expect({ value, source, shadowed }, `seed ${String(seed)}, ${field}`).toEqual(
            expected(state, member, field),
          );
        }
        expect(policy.tags, `seed ${String(seed)}, tags`).toEqual(
          expectedTags(project, state, member),
        );
      }
    }
  });

  it('resolves every member at once as it resolves each alone', () => {
    for (const seed of SEEDS) {
      const { project, state } = randomGameWorld(seed);
      const all = resolveAll(project, state);

      expect([...all.keys()]).toEqual(members(state).map(memberKey));
      for (const member of members(state)) {
        expect(all.get(memberKey(member)), `seed ${String(seed)}`).toEqual(
          resolvePolicy(project, state, member),
        );
      }
    }
  });

  it('gives the same answers whatever order the groups and the memberships are held in', () => {
    for (const seed of SEEDS) {
      const { project, state } = randomGameWorld(seed);
      const random = seededRandom(seed + 10_000);
      const permuted: GameAudioState = {
        groups: new Map(shuffled(random, [...state.groups])),
        memberships: shuffled(random, state.memberships),
      };
      const before = resolveAll(project, state);
      const after = resolveAll(project, permuted);

      for (const [key, policy] of before) {
        expect(after.get(key), `seed ${String(seed)}`).toEqual(policy);
      }
    }
  });

  it('reveals the nearest hidden value when an override is reset, and is restored when it is set again', () => {
    let resets = 0;
    for (const seed of SEEDS) {
      const { project, state } = randomGameWorld(seed);
      for (const membership of state.memberships) {
        for (const field of OVERRIDABLE) {
          const value = membership.overrides[field];
          if (value === undefined) continue;
          const before = resolvePolicy(project, state, membership.member);
          const reset = withOverrides(
            state,
            membership,
            withOverride(membership.overrides, field, undefined),
          );
          const after: Resolved<unknown> = resolvePolicy(project, reset, membership.member)[field];
          const [revealed, ...still] = before[field].shadowed;

          expect(after.value, `seed ${String(seed)}, ${field}`).toEqual(revealed?.value);
          expect(after.source.kind === 'group' ? after.source.group : undefined).toBe(
            revealed?.group,
          );
          expect(after.shadowed).toEqual(still);
          resets += 1;

          const restored = withOverrides(
            state,
            membership,
            withOverride(withOverride(membership.overrides, field, undefined), field, value),
          );
          expect(resolvePolicy(project, restored, membership.member)).toEqual(before);
        }
      }
    }
    expect(resets).toBeGreaterThan(100);
  });

  it('reveals what a group hid for every member below it when the group’s field is reset, and restores it when set again', () => {
    let resets = 0;
    for (const seed of SEEDS) {
      const { project, state } = randomGameWorld(seed);
      const before = resolveAll(project, state);
      for (const group of state.groups.values()) {
        for (const field of RESOLVED_FIELDS) {
          const value = group.policy[field];
          if (value === undefined) continue;
          const withGroup = (policy: GameAssetGroup['policy']): GameAudioState => ({
            ...state,
            groups: new Map(state.groups).set(group.id, { ...group, policy }),
          });
          const after = resolveAll(
            project,
            withGroup(withPolicyField(group.policy, field, undefined)),
          );

          for (const [key, policy] of before) {
            const was: Resolved<unknown> = policy[field];
            if (was.source.kind !== 'group' || was.source.group !== group.id) continue;
            const now: Resolved<unknown> | undefined = after.get(key)?.[field];
            expect(now?.value, `seed ${String(seed)}, ${field}`).toEqual(was.shadowed[0]?.value);
            resets += 1;
          }
          const restored = resolveAll(
            project,
            withGroup(
              withPolicyField(withPolicyField(group.policy, field, undefined), field, value),
            ),
          );
          expect([...restored]).toEqual([...before]);
        }
      }
    }
    expect(resets).toBeGreaterThan(100);
  });
});
