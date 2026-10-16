/**
 * Random game-audio state over a random project state, for the round trips of
 * the document and the tree and the history's differences (ADR-0106).
 *
 * The game-audio generator (`randomGameWorld`) makes a valid forest of groups,
 * every field of their policy and of their members' overrides sometimes set,
 * over a small project of its own. Its state is carried onto the project here:
 * each chain it names becomes one of the project's (or no chain, where the
 * project has none), each member one of the project's regions or assets of its
 * kind, each once, and every inheriting member's rack the chain it inherits; a
 * scenario's emitter plays the member it played as carried, or, where that
 * member was not carried, the group it was in. So the state is one
 * `validateGameAudioState` passes, which is asserted.
 */

import type { AssetId, EffectChainId, Project, RegionId } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  inheritingRacks,
  memberKey,
  validateGameAudioState,
  type GameAssetGroup,
  type GameAudioState,
  type GamePreviewScenario,
  type GroupMember,
  type GroupMembership,
  type PreviewSubject,
} from '@audiogubbins/game-audio';
import { randomGameWorld } from '@audiogubbins/game-audio/testing';

import { withGameAudio, type ProjectState } from '../project-state.js';
import type { Random } from './random-values.js';

/** The item of `onto` that the `index`th of `from` becomes, where `onto` has any. */
function carried<T>(onto: readonly T[], index: number): T | undefined {
  return onto.length === 0 || index < 0 ? undefined : onto[index % onto.length];
}

/** A member of the world as one of the project's, where the project has one of its kind. */
function memberOnto(
  world: Project,
  project: Project,
  member: GroupMember,
): GroupMember | undefined {
  if (member.kind === 'region') {
    const index = [...world.regions.keys()].indexOf(member.region);
    const region = carried<RegionId>([...project.regions.keys()], index);
    return region === undefined ? undefined : { kind: 'region', region };
  }
  const index = [...world.assets.keys()].indexOf(member.asset);
  const asset = carried<AssetId>([...project.assets.keys()], index);
  return asset === undefined ? undefined : { kind: 'asset', asset };
}

/** The world's state carried onto `project` (see the module comment), its racks not yet set. */
function stateOnto(world: Project, game: GameAudioState, project: Project): GameAudioState {
  const worldChains = [...world.effectChains.keys()];
  const projectChains = [...project.effectChains.keys()];
  const chainOnto = (chain: EffectChainId | 'none'): EffectChainId | 'none' =>
    chain === 'none' ? 'none' : (carried(projectChains, worldChains.indexOf(chain)) ?? 'none');
  const groups = new Map(
    [...game.groups].map(([id, group]): [typeof id, GameAssetGroup] => {
      const { processing } = group.policy;
      return [
        id,
        processing === undefined
          ? group
          : { ...group, policy: { ...group.policy, processing: chainOnto(processing) } },
      ];
    }),
  );
  const taken = new Set<string>();
  const memberships: GroupMembership[] = [];
  /** Each world member's subject in the project: itself carried, or the group it was in. */
  const subjects = new Map<string, PreviewSubject>();
  for (const membership of game.memberships) {
    const worldKey = memberKey(membership.member);
    const member = memberOnto(world, project, membership.member);
    if (member === undefined || taken.has(memberKey(member))) {
      subjects.set(worldKey, { kind: 'group', group: membership.group });
      continue;
    }
    taken.add(memberKey(member));
    memberships.push({ ...membership, member });
    subjects.set(worldKey, { kind: 'member', member });
  }
  const subjectOnto = (subject: PreviewSubject): PreviewSubject => {
    if (subject.kind === 'group') return subject;
    const carriedSubject = subjects.get(memberKey(subject.member));
    if (carriedSubject === undefined) throw new Error('A world scenario plays a world member.');
    return carriedSubject;
  };
  const scenarios = new Map(
    [...game.scenarios].map(([id, scenario]): [typeof id, GamePreviewScenario] => [
      id,
      {
        ...scenario,
        emitters: scenario.emitters.map((emitter) => ({
          ...emitter,
          subject: subjectOnto(emitter.subject),
        })),
      },
    ]),
  );
  return { groups, memberships, scenarios };
}

/** `project` with each inheriting member's rack the chain it inherits in `game`. */
function withInheritedRacks(project: Project, game: GameAudioState): Project {
  const regions = new Map(project.regions);
  const assets = new Map(project.assets);
  for (const { member, rack } of inheritingRacks(game)) {
    if (member.kind === 'region') {
      const region = regions.get(member.region);
      if (region === undefined) throw new Error('A carried member is a region of the project.');
      const { rack: _old, ...bare } = region;
      regions.set(member.region, rack === undefined ? bare : { ...bare, rack });
    } else {
      const asset = assets.get(member.asset);
      if (asset === undefined) throw new Error('A carried member is an asset of the project.');
      const { rack: _old, ...bare } = asset;
      assets.set(member.asset, rack === undefined ? bare : { ...bare, rack });
    }
  }
  return { ...project, regions, assets };
}

/** `state` with a random game-audio state over its project, from a world drawn by `random`. */
export function withRandomGameAudio(random: Random, state: ProjectState): ProjectState {
  const world = randomGameWorld(random.below(2 ** 31));
  const game = stateOnto(world.project, world.state, state.project);
  const project = withInheritedRacks(state.project, game);
  return withGameAudio({ ...state, project }, expectSuccess(validateGameAudioState(project, game)));
}
