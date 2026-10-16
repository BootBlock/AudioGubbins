/**
 * The project's game-audio state (ADR-0101, ADR-0106): its groups and who
 * belongs to them. Authoritative project state, changed only by the game
 * commands, each with its inverse, and held valid by `validateGameAudioState`.
 */

import type { GameAssetGroup } from './game-asset-group.js';
import type { GameAssetGroupId } from './group-ids.js';
import type { GroupMembership } from './membership.js';

export interface GameAudioState {
  readonly groups: ReadonlyMap<GameAssetGroupId, GameAssetGroup>;

  /**
   * In assignment order, each member at most once: the order a group's pool is
   * chosen in and `{number}` counts by.
   */
  readonly memberships: readonly GroupMembership[];
}
