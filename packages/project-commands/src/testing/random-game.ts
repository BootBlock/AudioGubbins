/**
 * Random invocations of the game commands (ADR-0101), for the random command
 * walk: mostly ones that apply to the state they are made for, sometimes ones
 * refused or changing nothing, as a person, a guided workflow or a journal
 * might send them: a group added with a name its siblings hold, moved inside
 * itself, removed while it holds members; a member given a rack while it
 * inherits, or reset where it overrides nothing; a preview scenario added,
 * changed and removed, sometimes playing a sound in no group, and the groups
 * and members scenarios play removed or taken out, which is refused.
 *
 * Policy values are the game-audio generator's own, collected once from the
 * worlds it makes, so each is a value its field takes; a processing value is
 * one of the state's chains, a new chain given whole, or none.
 */

import type { CommandInvocation } from '@audiogubbins/commands';
import type { EffectChain, IdGenerator } from '@audiogubbins/domain';
import {
  OVERRIDABLE_FIELDS,
  POLICY_FIELDS,
  withOverride,
  withPolicyField,
  type GameAssetGroup,
  type GameAssetGroupId,
  type GamePreviewScenario,
  type GroupMember,
  type InheritedPolicy,
  type MemberProcessing,
  type PolicyField,
  type PolicyOverrides,
  type PolicyValues,
  type PreviewSubject,
} from '@audiogubbins/game-audio';
import { randomGameWorld, randomScenario, seededRandom } from '@audiogubbins/game-audio/testing';
import type { ProjectState } from '@audiogubbins/project-format';
import { randomChain, randomName, type Random } from '@audiogubbins/project-format/testing';

import {
  addGroupInvocation,
  addScenarioInvocation,
  assignMemberInvocation,
  moveGroupInvocation,
  removeGroupInvocation,
  removeScenarioInvocation,
  renameGroupInvocation,
  resetMemberOverrideInvocation,
  setGroupPolicyInvocation,
  setMemberOverrideInvocation,
  setMemberProcessingInvocation,
  setScenarioInvocation,
  unassignMemberInvocation,
  type GivenRack,
} from '../game/game-invocations.js';

/** How many kinds of invocation {@link randomGameInvocation} chooses among. */
export const GAME_CHOICES = 15;

/** How many of the generator's worlds the values are collected from. */
const WORLDS = 32;

/** The fields whose values are collected; processing names the state's own chains. */
type CollectedField = Exclude<PolicyField, 'processing'>;

const COLLECTED = POLICY_FIELDS.filter((field): field is CollectedField => field !== 'processing');

type Pool = { readonly [F in CollectedField]: PolicyValues[F][] };

function collect<F extends CollectedField>(
  pool: Pool,
  field: F,
  value: PolicyValues[F] | undefined,
): void {
  if (value !== undefined) pool[field].push(value);
}

/** Every value the generator's worlds set, by field, and every group name they hold. */
function collected(): { readonly values: Pool; readonly names: readonly string[] } {
  const values: Pool = {
    loudness: [],
    exportProfile: [],
    naming: [],
    destination: [],
    emitter: [],
    variation: [],
    bus: [],
    tags: [],
  };
  const names = new Set<string>();
  const from = (set: InheritedPolicy): void => {
    for (const field of COLLECTED) collect(values, field, set[field]);
  };
  for (let seed = 1; seed <= WORLDS; seed += 1) {
    const { state } = randomGameWorld(seed);
    for (const group of state.groups.values()) {
      names.add(group.name);
      from(group.policy);
    }
    for (const membership of state.memberships) from(membership.overrides);
  }
  return { values, names: [...names] };
}

const POOL = collected();

/** A value of `field` the generator made, or `undefined` where it made none. */
function valueOf<F extends CollectedField>(random: Random, field: F): PolicyValues[F] | undefined {
  const values: readonly PolicyValues[F][] = POOL.values[field];
  return values.length === 0 ? undefined : random.pick(values);
}

/** A processing value: none, one of the state's chains, or a new chain given whole. */
function randomProcessing(
  random: Random,
  ids: IdGenerator,
  state: ProjectState,
): { readonly value: PolicyValues['processing']; readonly chain?: EffectChain } {
  const chains = [...state.project.effectChains.keys()];
  if (random.chance(0.2)) return { value: 'none' };
  if (chains.length === 0 || random.chance(0.4)) {
    const chain = randomChain(random, ids);
    return { value: chain.id, chain };
  }
  return { value: random.pick(chains) };
}

/** A group's name: mostly one the generator gave a group, so siblings sometimes share one. */
function randomGroupName(random: Random): string {
  return random.chance(0.8) ? random.pick(POOL.names) : randomName(random);
}

/** A new group, sometimes inside another, setting some fields; its chain where that is new. */
function randomGroup(
  random: Random,
  ids: IdGenerator,
  state: ProjectState,
  groups: readonly GameAssetGroup[],
): { readonly group: GameAssetGroup; readonly chain?: EffectChain } {
  const parent = groups.length > 0 && random.chance(0.6) ? random.pick(groups).id : undefined;
  let policy: InheritedPolicy = {};
  for (const field of COLLECTED) {
    if (random.chance(0.3)) policy = withPolicyField(policy, field, valueOf(random, field));
  }
  const processing = random.chance(0.4) ? randomProcessing(random, ids, state) : undefined;
  if (processing !== undefined) policy = withPolicyField(policy, 'processing', processing.value);
  const group: GameAssetGroup = {
    id: ids.next<'GameAssetGroupId'>(),
    name: randomGroupName(random),
    ...(parent === undefined ? {} : { parent }),
    policy,
  };
  return processing?.chain === undefined ? { group } : { group, chain: processing.chain };
}

/** The project's regions and assets, as members. */
function candidates(state: ProjectState): readonly GroupMember[] {
  return [
    ...[...state.project.regions.keys()].map((region): GroupMember => ({ kind: 'region', region })),
    ...[...state.project.assets.keys()].map((asset): GroupMember => ({ kind: 'asset', asset })),
  ];
}

/** Some overrides of the generator's values. */
function randomOverrides(random: Random): PolicyOverrides {
  let overrides: PolicyOverrides = {};
  for (const field of OVERRIDABLE_FIELDS) {
    if (random.chance(0.25)) overrides = withOverride(overrides, field, valueOf(random, field));
  }
  return overrides;
}

/**
 * What a scenario's emitters play: the state's groups and members, and now and
 * then a sound in no group, which the state refuses.
 */
function randomSubjects(
  random: Random,
  state: ProjectState,
  members: readonly GroupMember[],
): readonly PreviewSubject[] {
  const game = state.gameAudio;
  const subjects: PreviewSubject[] = [
    ...[...(game?.groups.keys() ?? [])].map((group): PreviewSubject => ({ kind: 'group', group })),
    ...(game?.memberships ?? []).map(({ member }): PreviewSubject => ({ kind: 'member', member })),
  ];
  return subjects.length === 0 || random.chance(0.05)
    ? [...subjects, { kind: 'member', member: random.pick(members) }]
    : subjects;
}

/** A scenario changed: renamed, given a new seed, or replaced by another under its identifier. */
function changedScenario(
  random: Random,
  ids: IdGenerator,
  scenario: GamePreviewScenario,
  subjects: readonly PreviewSubject[],
): GamePreviewScenario {
  switch (random.below(3)) {
    case 0:
      return { ...scenario, name: randomName(random) };
    case 1:
      return { ...scenario, seed: random.below(2 ** 32) };
    default:
      return {
        ...randomScenario(seededRandom(random.below(2 ** 31)), ids, subjects),
        id: scenario.id,
      };
  }
}

/** A rack an owning member is given: none, one of the state's chains, or a new one whole. */
function randomRack(random: Random, ids: IdGenerator, state: ProjectState): GivenRack {
  const { value, chain } = randomProcessing(random, ids, state);
  return chain ?? value;
}

/**
 * A random invocation of a game command against `state`, of the kind `choice`
 * names, below {@link GAME_CHOICES}; a group is added where there is none to
 * act on.
 */
export function randomGameInvocation(
  random: Random,
  ids: IdGenerator,
  state: ProjectState,
  choice: number,
): CommandInvocation {
  const groups = [...(state.gameAudio?.groups.values() ?? [])];
  const memberships = state.gameAudio?.memberships ?? [];
  const members = candidates(state);
  if (groups.length === 0 || members.length === 0 || choice === 0) {
    const { group, chain } = randomGroup(random, ids, state, groups);
    return addGroupInvocation(group, chain);
  }
  const group = random.pick(groups);
  const joined =
    memberships.length > 0 && random.chance(0.8) ? random.pick(memberships).member : undefined;
  const member = joined ?? random.pick(members);
  const processing: MemberProcessing = random.chance(0.6) ? 'inherit' : 'own';
  switch (choice) {
    case 1:
      return removeGroupInvocation(group.id);
    case 2:
      return renameGroupInvocation(group.id, randomGroupName(random));
    case 3: {
      const parent: GameAssetGroupId | undefined = random.chance(0.3)
        ? undefined
        : random.pick(groups).id;
      return moveGroupInvocation(group.id, parent);
    }
    case 4:
    case 5: {
      const field = random.pick(POLICY_FIELDS);
      if (random.chance(0.25)) return setGroupPolicyInvocation(group.id, field, undefined);
      if (field === 'processing') {
        const { value, chain } = randomProcessing(random, ids, state);
        return setGroupPolicyInvocation(group.id, field, value, chain);
      }
      return setGroupPolicyInvocation(group.id, field, valueOf(random, field));
    }
    case 6:
    case 7:
      return assignMemberInvocation(random.pick(members), group.id, processing, {
        ...(random.chance(0.4) ? { overrides: randomOverrides(random) } : {}),
        ...(random.chance(0.2) ? { position: random.below(memberships.length + 1) } : {}),
        ...(random.chance(0.15) ? { rack: randomRack(random, ids, state) } : {}),
      });
    case 8:
      return unassignMemberInvocation(
        member,
        random.chance(0.2) ? randomRack(random, ids, state) : undefined,
      );
    case 9: {
      const field = random.pick(OVERRIDABLE_FIELDS);
      const value = valueOf(random, field);
      return value === undefined
        ? resetMemberOverrideInvocation(member, field)
        : setMemberOverrideInvocation(member, field, value);
    }
    case 10:
      return resetMemberOverrideInvocation(member, random.pick(OVERRIDABLE_FIELDS));
    case 11:
      return setMemberProcessingInvocation(
        member,
        processing,
        random.chance(0.3) ? randomRack(random, ids, state) : undefined,
      );
    default:
      return randomScenarioInvocation(random, ids, state, members, choice);
  }
}

/** An invocation of a scenario command, of the kind `choice` names, 12 to 14. */
function randomScenarioInvocation(
  random: Random,
  ids: IdGenerator,
  state: ProjectState,
  members: readonly GroupMember[],
  choice: number,
): CommandInvocation {
  const subjects = randomSubjects(random, state, members);
  const scenarios = [...(state.gameAudio?.scenarios.values() ?? [])];
  const held = scenarios.length > 0 ? random.pick(scenarios) : undefined;
  if (choice === 12 || held === undefined) {
    // Now and then one the state holds already, which is refused.
    const again = held !== undefined && random.chance(0.1);
    return addScenarioInvocation(
      again ? held : randomScenario(seededRandom(random.below(2 ** 31)), ids, subjects),
    );
  }
  return choice === 13
    ? setScenarioInvocation(changedScenario(random, ids, held, subjects))
    : removeScenarioInvocation(held.id);
}
