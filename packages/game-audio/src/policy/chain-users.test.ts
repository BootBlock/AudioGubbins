import { describe, expect, it } from 'vitest';

import {
  chainUseCount,
  chainUsers,
  createDeterministicIdGenerator,
  type EffectChainId,
} from '@audiogubbins/domain';

import type { GameAudioState } from '../groups/game-audio-state.js';
import type { GameAssetGroupId } from '../groups/group-ids.js';
import { worldAsset, worldProject, worldRegion } from '../testing/random-game-state.js';
import { projectChainUsers, stateChainUseCount } from './chain-users.js';

const racked = 'chain-racked' as EffectChainId;
const grouped = 'chain-grouped' as EffectChainId;
const ids = createDeterministicIdGenerator(3);
const sound = worldAsset(ids, 'Door', racked);
const PROJECT = worldProject(ids, {
  assets: [sound],
  regions: [worldRegion(ids, sound, 'Creak', [], racked)],
  chains: [racked, grouped],
});

const first = 'group-1' as GameAssetGroupId;
const second = 'group-2' as GameAssetGroupId;
const third = 'group-3' as GameAssetGroupId;
const STATE: GameAudioState = {
  groups: new Map([
    [second, { id: second, name: 'Doors', policy: { processing: grouped } }],
    [first, { id: first, name: 'Wood', parent: second, policy: { processing: 'none' } }],
    [third, { id: third, name: 'Metal', parent: second, policy: { processing: grouped } }],
  ]),
  memberships: [],
};

describe('the users of a chain, the groups included (ADR-0101)', () => {
  it('answers as the domain does where no group names the chain', () => {
    const users = projectChainUsers(PROJECT, STATE, racked);

    expect(users).toEqual({ ...chainUsers(PROJECT, racked), groups: [] });
    expect(stateChainUseCount(users)).toBe(chainUseCount(chainUsers(PROJECT, racked)));
    expect(stateChainUseCount(users)).toBe(2);
  });

  it('answers as the domain does for a project that has no game-audio state', () => {
    expect(projectChainUsers(PROJECT, undefined, grouped)).toEqual({
      ...chainUsers(PROJECT, grouped),
      groups: [],
    });
  });

  it('counts a chain only groups name as used, which the domain alone takes for unused', () => {
    const users = projectChainUsers(PROJECT, STATE, grouped);

    expect(chainUseCount(chainUsers(PROJECT, grouped))).toBe(0);
    expect(users.groups).toEqual([second, third]);
    expect(stateChainUseCount(users)).toBe(2);
  });
});
