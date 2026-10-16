import { describe, expect, it } from 'vitest';

import {
  createDeterministicIdGenerator,
  type EffectChainId,
  type Project,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import type { GameAudioState } from '../groups/game-audio-state.js';
import type { GameAssetGroupId } from '../groups/group-ids.js';
import { memberKey, type GroupMember } from '../groups/membership.js';
import { validateGameAudioState } from '../groups/state-validation.js';
import { worldAsset, worldProject, worldRegion } from '../testing/random-game-state.js';
import { withPolicyField } from './inherited-policy.js';
import type { PolicyValues } from './policy-fields.js';
import { inheritedProcessing, inheritingRacks } from './processing-realisation.js';

const chainA = 'chain-a' as EffectChainId;
const chainB = 'chain-b' as EffectChainId;
const sfx = 'group-sfx' as GameAssetGroupId;
const steps = 'group-steps' as GameAssetGroupId;

const ids = createDeterministicIdGenerator(5);
const sound = worldAsset(ids, 'Footsteps');
const first = worldRegion(ids, sound, 'Step 1');
const second = worldRegion(ids, sound, 'Step 2');
const loose = worldRegion(ids, sound, 'Loose');
const PROJECT = worldProject(ids, {
  assets: [sound],
  regions: [first, second, loose],
  chains: [chainA, chainB],
});
const one: GroupMember = { kind: 'region', region: first.id };
const two: GroupMember = { kind: 'region', region: second.id };
const outside: GroupMember = { kind: 'region', region: loose.id };

/** SFX ⊃ Steps; Step 1 inherits in Steps, Step 2 owns its processing there. */
function stateOf(
  sfxProcessing?: PolicyValues['processing'],
  stepsProcessing?: PolicyValues['processing'],
): GameAudioState {
  return {
    groups: new Map([
      [sfx, { id: sfx, name: 'SFX', policy: withPolicyField({}, 'processing', sfxProcessing) }],
      [
        steps,
        {
          id: steps,
          name: 'Steps',
          parent: sfx,
          policy: withPolicyField({}, 'processing', stepsProcessing),
        },
      ],
    ]),
    memberships: [
      { member: one, group: steps, processing: 'inherit', overrides: {} },
      { member: two, group: steps, processing: 'own', overrides: {} },
    ],
    scenarios: new Map(),
  };
}

/** The project with each rack `inheritingRacks` gives set, as the game commands set them. */
function realised(state: GameAudioState, project: Project = PROJECT): Project {
  const racks = new Map(
    inheritingRacks(state).map(({ member, rack }) => [memberKey(member), rack]),
  );
  return {
    ...project,
    regions: new Map(
      [...project.regions].map(([id, region]) => {
        const key = memberKey({ kind: 'region', region: id });
        if (!racks.has(key)) return [id, region];
        const { rack: _old, ...rest } = region;
        const rack = racks.get(key);
        return [id, rack === undefined ? rest : { ...rest, rack }];
      }),
    ),
  };
}

describe('the processing an inheriting member is heard through (ADR-0101)', () => {
  it('is the chain the nearest group that sets processing names', () => {
    expect(inheritedProcessing(stateOf(chainA), one)).toBe(chainA);
    expect(inheritedProcessing(stateOf(chainA, chainB), one)).toBe(chainB);
  });

  it('is no rack where the nearest setting is none, or where no group sets processing', () => {
    expect(inheritedProcessing(stateOf(chainA, 'none'), one)).toBeUndefined();
    expect(inheritedProcessing(stateOf(), one)).toBeUndefined();
  });

  it('is no rack for a member in no group, and its group’s for one that owns its processing', () => {
    expect(inheritedProcessing(stateOf(chainA), outside)).toBeUndefined();
    expect(inheritedProcessing(stateOf(chainA), two)).toBe(chainA);
  });

  it('lists the rack of every inheriting member, and of no member that owns its processing', () => {
    expect(inheritingRacks(stateOf(chainA))).toEqual([{ member: one, rack: chainA }]);
    expect(inheritingRacks(stateOf('none'))).toEqual([{ member: one, rack: undefined }]);
  });

  it('takes every inheritor from A to no rack to B, each step a state the validator passes', () => {
    let project = PROJECT;
    const racksSeen: (EffectChainId | undefined)[] = [];
    for (const processing of [chainA, 'none', chainB] as const) {
      const state = stateOf(processing);
      project = realised(state, project);
      expectSuccess(validateGameAudioState(project, state));
      racksSeen.push(project.regions.get(first.id)?.rack);
    }

    expect(racksSeen).toEqual([chainA, undefined, chainB]);
    // The member that owns its processing kept what it had throughout.
    expect(project.regions.get(second.id)?.rack).toBeUndefined();
  });
});
