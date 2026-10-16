import { describe, expect, it } from 'vitest';

import type { EffectChainId } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  busName,
  memberKey,
  type GameAssetGroup,
  type GameAudioState,
  type GamePreviewScenario,
  type GroupMembership,
} from '@audiogubbins/game-audio';
import { compareCodeUnits, type ProjectState } from '@audiogubbins/project-format';
import { groupedReferenceState } from '@audiogubbins/project-format/testing';
import { sampleProject } from '@audiogubbins/test-fixtures';

import { affectedBy } from './affected-entities.js';
import { chainOwner, differenceNames } from './difference-names.js';
import { diffStates } from './state-diff.js';

/**
 * The difference of two states' asset groups and memberships (ADR-0106,
 * REQ-STOR-195): each group's settings one field each, a member joining,
 * leaving or moving a difference of the member and of its groups, every
 * group named by its path and every member by its name, and a chain a group
 * processes with named for the group.
 */

const fixture = sampleProject();
const { state: GROUPED, outer, inner, chain, scenario } = groupedReferenceState(fixture);

function gameOf(state: ProjectState): GameAudioState {
  if (state.gameAudio === undefined) throw new Error('The state has asset groups.');
  return state.gameAudio;
}

const [IN_INNER, IN_OUTER] = gameOf(GROUPED).memberships;
if (IN_INNER === undefined || IN_OUTER === undefined) {
  throw new Error('The grouped state has two memberships.');
}
const REGION_KEY = memberKey(IN_INNER.member);
const FOOTSTEP_KEY = memberKey(IN_OUTER.member);
const { footstep, ambience } = fixture.assets;

/** `GROUPED` with its groups replaced by those given, by identifier. */
function withGroups(...groups: readonly GameAssetGroup[]): ProjectState {
  const game = gameOf(GROUPED);
  const changed = new Map(game.groups);
  for (const group of groups) changed.set(group.id, group);
  return { ...GROUPED, gameAudio: { ...game, groups: changed } };
}

/** `GROUPED` with these memberships. */
function withMemberships(...memberships: readonly GroupMembership[]): ProjectState {
  return { ...GROUPED, gameAudio: { ...gameOf(GROUPED), memberships } };
}

/** Identifiers in the order a difference lists them. */
function inOrder<T extends string>(...ids: readonly T[]): readonly T[] {
  return [...ids].sort(compareCodeUnits);
}

const NONE = { added: [], removed: [], changed: [] };

describe('the difference of two states’ asset groups (ADR-0106, REQ-STOR-195)', () => {
  it('is none where two states share their groups, or hold equal groups built apart', () => {
    const rebuilt: ProjectState = { ...GROUPED, gameAudio: structuredClone(gameOf(GROUPED)) };
    for (const after of [GROUPED, rebuilt]) {
      const difference = diffStates(GROUPED, after);
      expect(difference.gameGroups).toEqual(NONE);
      expect(difference.gameMembers).toEqual(NONE);
    }
  });

  it('says which of a group’s fields changed: its name, its place and each field of its policy', () => {
    const { loudness: _loudness, ...unloud } = outer.policy;
    const after = withGroups(
      { ...inner, name: 'Gravel' },
      { ...outer, policy: { ...unloud, bus: expectSuccess(busName('Ambience')) } },
    );
    const changed = diffStates(GROUPED, after).gameGroups.changed;
    expect(changed).toEqual(
      [
        { id: inner.id, fields: ['name'] },
        { id: outer.id, fields: ['loudness', 'bus'] },
      ].sort((one, other) => compareCodeUnits(one.id, other.id)),
    );

    const { parent: _parent, ...root } = inner;
    expect(diffStates(GROUPED, withGroups(root)).gameGroups.changed).toEqual([
      { id: inner.id, fields: ['parent'] },
    ]);
  });

  it('tells a member moving between groups apart, as a difference of the member and of both groups', () => {
    const after = withMemberships(IN_INNER, { ...IN_OUTER, group: inner.id });
    const difference = diffStates(GROUPED, after);
    expect(difference.gameMembers).toEqual({
      ...NONE,
      changed: [{ id: FOOTSTEP_KEY, fields: ['group'] }],
    });
    expect(difference.gameGroups.changed).toEqual(
      inOrder(outer.id, inner.id).map((id) => ({ id, fields: ['members'] })),
    );
    const affected = affectedBy(GROUPED, after);
    expect(affected.gameGroups).toEqual(inOrder(outer.id, inner.id));
    expect(affected.assets).toEqual([footstep.id]);
  });

  it('tells a member joining and leaving apart, affecting the member and its group', () => {
    const joined = withMemberships(IN_INNER, IN_OUTER, {
      member: { kind: 'asset', asset: ambience.id },
      group: inner.id,
      processing: 'own',
      overrides: {},
    });
    const difference = diffStates(GROUPED, joined);
    expect(difference.gameMembers).toEqual({ ...NONE, added: [`asset:${ambience.id}`] });
    expect(difference.gameGroups.changed).toEqual([{ id: inner.id, fields: ['members'] }]);
    expect(affectedBy(GROUPED, joined)).toMatchObject({
      assets: [ambience.id],
      gameGroups: [inner.id],
    });

    const left = withMemberships(IN_OUTER);
    expect(diffStates(GROUPED, left).gameMembers).toEqual({ ...NONE, removed: [REGION_KEY] });
    expect(affectedBy(GROUPED, left)).toMatchObject({
      regions: [IN_INNER.member.kind === 'region' ? IN_INNER.member.region : ''],
      gameGroups: [inner.id],
    });
  });

  it('says which override of a member changed, or whether it inherits its processing', () => {
    const { naming: _naming, ...overrides } = IN_OUTER.overrides;
    const after = withMemberships(IN_INNER, {
      ...IN_OUTER,
      processing: 'inherit',
      overrides: { ...overrides, bus: expectSuccess(busName('Ambience')) },
    });
    expect(diffStates(GROUPED, after).gameMembers.changed).toEqual([
      { id: FOOTSTEP_KEY, fields: ['processing', 'naming', 'bus'] },
    ]);
    expect(diffStates(GROUPED, after).gameGroups).toEqual(NONE);
  });

  it('tells the order of a group’s members apart, the order its members are numbered in', () => {
    const another: GroupMembership = {
      member: { kind: 'asset', asset: ambience.id },
      group: outer.id,
      processing: 'own',
      overrides: {},
    };
    const before = withMemberships(IN_INNER, IN_OUTER, another);
    const reordered = withMemberships(IN_INNER, another, IN_OUTER);
    expect(diffStates(before, reordered).gameGroups.changed).toEqual([
      { id: outer.id, fields: ['members'] },
    ]);
    expect(diffStates(before, reordered).gameMembers).toEqual(NONE);
    // Members of different groups keep their own groups' orders, which is all the order says.
    const interleaved = withMemberships(IN_OUTER, IN_INNER);
    expect(diffStates(GROUPED, interleaved).gameGroups).toEqual(NONE);
  });

  it('finds every group and member added where a project had none', () => {
    const { gameAudio: _game, ...ungrouped } = GROUPED;
    const difference = diffStates(ungrouped, GROUPED);
    expect(difference.gameGroups).toEqual({ ...NONE, added: inOrder(outer.id, inner.id) });
    expect(difference.gameMembers).toEqual({
      ...NONE,
      added: inOrder(REGION_KEY, FOOTSTEP_KEY),
    });
    expect(diffStates(GROUPED, ungrouped).gameGroups.removed).toEqual(inOrder(outer.id, inner.id));
  });
});

describe('the names of a difference’s groups and members', () => {
  it('names a group by its path from its root, and a member by its region’s or asset’s name', () => {
    const after = withGroups({ ...inner, name: 'Gravel' });
    const moved = { ...after, gameAudio: { ...gameOf(after), memberships: [IN_INNER] } };
    const names = differenceNames(GROUPED, moved, diffStates(GROUPED, moved));
    expect(names.entities.get(inner.id)).toBe('Footsteps/Gravel');
    expect(names.entities.get(FOOTSTEP_KEY)).toBe(footstep.displayName);

    // A group taken away is named from the state that held it.
    const removed: ProjectState = {
      ...GROUPED,
      gameAudio: {
        groups: new Map([[outer.id, outer]]),
        memberships: [IN_OUTER],
        scenarios: new Map(),
      },
    };
    const gone = differenceNames(GROUPED, removed, diffStates(GROUPED, removed));
    expect(gone.entities.get(inner.id)).toBe('Footsteps/Grass');
    const [region] = GROUPED.project.regions.values();
    expect(gone.entities.get(REGION_KEY)).toBe(region?.displayName);
  });

  it('names a chain a group processes with for the group, before the racks that inherit it', () => {
    const own: EffectChainId = fixture.ids.next<'EffectChainId'>();
    const region = IN_INNER.member.kind === 'region' ? IN_INNER.member.region : undefined;
    const held = region === undefined ? undefined : GROUPED.project.regions.get(region);
    if (held === undefined) throw new Error('The inner group’s member is a region of the project.');
    const after: ProjectState = {
      ...withGroups({ ...outer, policy: { ...outer.policy, processing: own } }),
      project: {
        ...GROUPED.project,
        effectChains: new Map([...GROUPED.project.effectChains, [own, { id: own, slots: [] }]]),
        regions: new Map([...GROUPED.project.regions, [held.id, { ...held, rack: own }]]),
      },
    };
    const owner = { kind: 'game-group', naming: 'whole', name: 'Footsteps' };
    expect(chainOwner(after, own)).toEqual(owner);
    expect(differenceNames(GROUPED, after, diffStates(GROUPED, after)).chains.get(own)).toEqual(
      owner,
    );
    // Without its groups, the chain is the region's rack.
    const { gameAudio: _game, ...ungrouped } = after;
    expect(chainOwner(ungrouped, own)).toEqual({
      kind: 'region',
      naming: 'whole',
      name: held.displayName,
    });
    // A chain a track or bus has is still theirs first: the reference bus has the outer group's chain.
    expect(chainOwner(GROUPED, chain)?.kind).toBe('bus');
  });
});

describe('the difference of two states’ preview scenarios (ADR-0106, REQ-STOR-195)', () => {
  /** `GROUPED` with its scenarios those given. */
  function withScenarios(...scenarios: readonly GamePreviewScenario[]): ProjectState {
    return {
      ...GROUPED,
      gameAudio: { ...gameOf(GROUPED), scenarios: new Map(scenarios.map((one) => [one.id, one])) },
    };
  }
  const [, flat] = [...gameOf(GROUPED).scenarios.values()].sort((left, right) =>
    left.id === scenario.id ? -1 : right.id === scenario.id ? 1 : 0,
  );
  if (flat === undefined) throw new Error('The grouped state has two scenarios.');

  it('is none for equal scenarios built apart', () => {
    const rebuilt: ProjectState = { ...GROUPED, gameAudio: structuredClone(gameOf(GROUPED)) };
    expect(diffStates(GROUPED, rebuilt).gameScenarios).toEqual(NONE);
    expect(affectedBy(GROUPED, rebuilt).project).toBe(false);
  });

  it('says which parts of a scenario changed, and that the change affected the project', () => {
    const [walker, door] = scenario.emitters;
    if (walker === undefined || door === undefined) throw new Error('Two emitters.');
    const after = withScenarios(
      { ...scenario, name: 'Hall', seed: 1, emitters: [{ ...walker, name: 'Runner' }, door] },
      flat,
    );
    const difference = diffStates(GROUPED, after);
    expect(difference.gameScenarios).toEqual({
      ...NONE,
      changed: [{ id: scenario.id, fields: ['name', 'emitters', 'seed'] }],
    });
    expect(difference.gameGroups).toEqual(NONE);
    expect(affectedBy(GROUPED, after).project).toBe(true);
    expect(differenceNames(GROUPED, after, difference).entities.get(scenario.id)).toBe('Hall');
  });

  it('lists a scenario added or removed, named from the state that holds it', () => {
    const removed = withScenarios(flat);
    const difference = diffStates(GROUPED, removed);
    expect(difference.gameScenarios).toEqual({ ...NONE, removed: [scenario.id] });
    expect(differenceNames(GROUPED, removed, difference).entities.get(scenario.id)).toBe(
      'Corridor',
    );
    expect(diffStates(removed, GROUPED).gameScenarios).toEqual({ ...NONE, added: [scenario.id] });
  });
});
