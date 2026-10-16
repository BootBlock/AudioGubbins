/**
 * What names a chain, the groups included (ADR-0101): the one function every
 * reader of a chain's users reads.
 *
 * A group's `processing` names a chain, and the domain's `chainUsers` sees the
 * project alone, so a reader that asked it would take a chain only a group
 * names for unused: name it as such, or remove it from under the group. This
 * answers for the project and its groups together.
 */

import {
  chainUseCount,
  chainUsers,
  type ChainUsers,
  type EffectChainId,
  type Project,
} from '@audiogubbins/domain';

import type { GameAudioState } from '../groups/game-audio-state.js';
import type { GameAssetGroupId } from '../groups/group-ids.js';

export interface StateChainUsers extends ChainUsers {
  /** The groups whose `processing` names the chain, in the order the state holds them. */
  readonly groups: readonly GameAssetGroupId[];
}

/** What names `chain` in the project and in its game-audio state, where it has one. */
export function projectChainUsers(
  project: Project,
  game: GameAudioState | undefined,
  chain: EffectChainId,
): StateChainUsers {
  const groups =
    game === undefined
      ? []
      : [...game.groups.values()]
          .filter((group) => group.policy.processing === chain)
          .map((group) => group.id);
  return { ...chainUsers(project, chain), groups };
}

/** How many operations, targets and groups name the chain. */
export function stateChainUseCount(users: StateChainUsers): number {
  return chainUseCount(users) + users.groups.length;
}
