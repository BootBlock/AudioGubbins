/**
 * The game-audio state as the game commands find it and leave it (ADR-0101,
 * ADR-0106): the one way a command's result is made to hold its groups.
 *
 * A group's processing is heard through the rack of each member that inherits
 * it, so a change to what a member inherits is a change to its rack in the same
 * command. {@link withGame} makes every `inherit` member's rack what it
 * inherits in the state given, the full set (`inheritingRacks`), which is the
 * same whichever change moved it, and then holds the result to
 * `validateGameAudioState`, as every command's result is held. A command that
 * must not move a rack, such as the rack command itself, is held by
 * {@link heldValid} instead, so a rack that disagrees with its membership is
 * refused rather than corrected.
 */

import {
  fail,
  succeed,
  type DomainResult,
  type Asset,
  type EffectChainId,
  type Project,
  type Region,
} from '@audiogubbins/domain';
import {
  inheritingRacks,
  memberKey,
  validateGameAudioState,
  type GameAudioState,
  type GroupMember,
  type GroupMembership,
} from '@audiogubbins/game-audio';
import { withGameAudio, type ProjectState } from '@audiogubbins/project-format';

/** What a project with no groups holds. */
const NO_GAME_AUDIO: GameAudioState = { groups: new Map(), memberships: [] };

/** The code a rack that is not what its member inherits is refused under. */
const PROCESSING_MISMATCH = 'game.member-processing-mismatch';

/** The project's game-audio state, or one with no groups where it has none. */
export function gameOf(state: ProjectState): GameAudioState {
  return state.gameAudio ?? NO_GAME_AUDIO;
}

/** The rack `member` has in `project`, or `undefined` where it has none or is not there. */
export function rackOf(project: Project, member: GroupMember): EffectChainId | undefined {
  return member.kind === 'region'
    ? project.regions.get(member.region)?.rack
    : project.assets.get(member.asset)?.rack;
}

/** The region with the rack `rack`, or none where it is absent. */
function regionWithRack(region: Region, rack: EffectChainId | undefined): Region {
  const { rack: _previous, ...rest } = region;
  return rack === undefined ? rest : { ...rest, rack };
}

/** The asset with the rack `rack`, or none where it is absent. */
function assetWithRack(asset: Asset, rack: EffectChainId | undefined): Asset {
  const { rack: _previous, ...rest } = asset;
  return rack === undefined ? rest : { ...rest, rack };
}

/**
 * `project` with `member`'s rack `rack`, or none where it is absent: the one
 * way a rack is set. Throws where the project has no such member: every caller
 * names one it found there, or one a state the validator passed holds.
 */
export function projectWithRack(
  project: Project,
  member: GroupMember,
  rack: EffectChainId | undefined,
): Project {
  if (member.kind === 'region') {
    const region = project.regions.get(member.region);
    if (region === undefined) throw new Error(`Region ${member.region} is not in the project.`);
    const regions = new Map(project.regions).set(region.id, regionWithRack(region, rack));
    return { ...project, regions };
  }
  const asset = project.assets.get(member.asset);
  if (asset === undefined) throw new Error(`Asset ${member.asset} is not in the project.`);
  return { ...project, assets: new Map(project.assets).set(asset.id, assetWithRack(asset, rack)) };
}

/**
 * `state` holding `game` with every `inherit` member's rack the one it
 * inherits there, or every reason the project cannot hold `game`.
 *
 * Racks follow only a forest that reads: a member's inheritance is not
 * defined in a cycle or under a group that is not there. So the state is first
 * held to every rule but the racks', which are the ones this sets.
 */
export function withGame(state: ProjectState, game: GameAudioState): DomainResult<ProjectState> {
  const shape = validateGameAudioState(state.project, game);
  if (!shape.ok) {
    const [first, ...rest] = shape.failures.filter(({ code }) => code !== PROCESSING_MISMATCH);
    if (first !== undefined) return fail(first, ...rest);
  }
  let project = state.project;
  for (const { member, rack } of inheritingRacks(game)) {
    if (rackOf(project, member) !== rack) project = projectWithRack(project, member, rack);
  }
  return heldValid({ ...state, project }, game);
}

/** `state` holding `game` as it is, or every reason the project cannot hold it. */
export function heldValid(state: ProjectState, game: GameAudioState): DomainResult<ProjectState> {
  const valid = validateGameAudioState(state.project, game);
  return valid.ok ? succeed(withGameAudio(state, valid.value)) : valid;
}

/** Where `member`'s membership stands in `game`'s assignment order, or `undefined` where it has none. */
export function membershipIndex(game: GameAudioState, member: GroupMember): number | undefined {
  const key = memberKey(member);
  const index = game.memberships.findIndex((one) => memberKey(one.member) === key);
  return index < 0 ? undefined : index;
}

/** `game` with `member`'s membership taken out, where it has one. */
export function withoutMembership(game: GameAudioState, member: GroupMember): GameAudioState {
  const key = memberKey(member);
  return { ...game, memberships: game.memberships.filter((one) => memberKey(one.member) !== key) };
}

/**
 * `game` with `membership` at `position` in the assignment order, in place of
 * its member's membership where it has one: where `position` is absent, at
 * that one's place, or after every other.
 */
export function withMembership(
  game: GameAudioState,
  membership: GroupMembership,
  position: number | undefined,
): GameAudioState {
  const at = position ?? membershipIndex(game, membership.member);
  const others = withoutMembership(game, membership.member).memberships;
  const memberships =
    at === undefined ? [...others, membership] : others.toSpliced(at, 0, membership);
  return { ...game, memberships };
}
