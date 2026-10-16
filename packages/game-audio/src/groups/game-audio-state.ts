/**
 * The project's game-audio state (ADR-0101, ADR-0104, ADR-0106): its groups,
 * who belongs to them, and the preview scenarios that play them. Authoritative
 * project state, changed only by the game commands, each with its inverse, and
 * held valid by `validateGameAudioState`.
 */

import type { GamePreviewScenario, GamePreviewScenarioId } from '../preview/preview-scenario.js';
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

  /** The preview's test benches, each under its own identifier. */
  readonly scenarios: ReadonlyMap<GamePreviewScenarioId, GamePreviewScenario>;
}

/** A state of no group, no member and no scenario: what a project without game audio holds. */
export const NO_GAME_AUDIO: GameAudioState = {
  groups: new Map(),
  memberships: [],
  scenarios: new Map(),
};

/**
 * Whether `state` holds nothing, the one test of it: a project keeps such a
 * state by having none, so one state is held and written one way.
 */
export function holdsNoGameAudio(state: GameAudioState): boolean {
  return state.groups.size === 0 && state.memberships.length === 0 && state.scenarios.size === 0;
}
