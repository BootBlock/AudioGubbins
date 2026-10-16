/**
 * The identifiers the game-audio state gives its own entities (ADR-0101).
 *
 * Branded like the domain's, so a group's identifier is never taken for a
 * region's or a chain's; minted by the caller's `IdGenerator`, never derived
 * from a name, so renaming a group changes no reference to it.
 */

import type { Branded } from '@audiogubbins/domain';

/** Identifies an asset group. */
export type GameAssetGroupId = Branded<'GameAssetGroupId'>;
