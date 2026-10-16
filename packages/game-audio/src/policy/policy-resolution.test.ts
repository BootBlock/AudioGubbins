import { describe, expect, it } from 'vitest';

import type { AssetId, EffectChainId, Project, RegionId } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { createDeterministicIdGenerator } from '@audiogubbins/domain';

import { namingTemplate } from '../export/naming-template.js';
import type { GameAssetGroup } from '../groups/game-asset-group.js';
import type { GameAudioState } from '../groups/game-audio-state.js';
import type { GameAssetGroupId } from '../groups/group-ids.js';
import { memberKey, type GroupMember } from '../groups/membership.js';
import { validateGameAudioState } from '../groups/state-validation.js';
import { worldAsset, worldProject, worldRegion } from '../testing/random-game-state.js';
import { busName } from './bus-name.js';
import { DEFAULT_EMITTER_RULES } from './playback-rules.js';
import { resolveAll, resolveGroupPolicy, resolvePolicy } from './policy-resolution.js';

const sfxId = 'group-sfx' as GameAssetGroupId;
const footstepsId = 'group-footsteps' as GameAssetGroupId;
const grassId = 'group-grass' as GameAssetGroupId;
const chainA = 'chain-a' as EffectChainId;

const templates = {
  root: expectSuccess(namingTemplate('{group:snake}_{number}')),
  footsteps: expectSuccess(namingTemplate('{group-path:kebab}')),
  member: expectSuccess(namingTemplate('{region:pascal}')),
};
const loud = { integratedLufs: -16, toleranceLu: 1 };
const quiet = { integratedLufs: -24, toleranceLu: 2, truePeakCeilingDbtp: -2 };
const emitter = { ...DEFAULT_EMITTER_RULES, cooldownMilliseconds: 50 };
const sfxBus = expectSuccess(busName('SFX'));

/**
 * SFX (naming, loudness, emitter, tags, chain A) ⊃ Footsteps (naming, tags,
 * bus) ⊃ Grass (loudness, processing none). The fixture's loop region is in
 * Grass, inheriting, overriding its naming; the ambience asset is in Footsteps
 * and owns its processing (chain A); the footstep asset is in no group.
 */
function world(): {
  project: Project;
  state: GameAudioState;
  loop: GroupMember;
  ambience: GroupMember;
  footstep: GroupMember;
} {
  const ids = createDeterministicIdGenerator(7);
  const footstepAsset = worldAsset(ids, 'Gravel footstep');
  const ambienceAsset = worldAsset(ids, 'Forest ambience', chainA);
  const loopRegion = worldRegion(ids, footstepAsset, 'Walk loop', ['footstep', 'gravel']);
  const project = worldProject(ids, {
    assets: [footstepAsset, ambienceAsset],
    regions: [loopRegion],
    chains: [chainA],
  });
  const groups: GameAssetGroup[] = [
    {
      id: sfxId,
      name: 'SFX',
      policy: {
        naming: templates.root,
        loudness: loud,
        emitter,
        tags: ['sfx', 'footstep'],
        processing: chainA,
      },
    },
    {
      id: footstepsId,
      name: 'Footsteps',
      parent: sfxId,
      policy: { naming: templates.footsteps, tags: ['footstep'], bus: sfxBus },
    },
    {
      id: grassId,
      name: 'Grass',
      parent: footstepsId,
      policy: { loudness: quiet, processing: 'none' },
    },
  ];
  const loop: GroupMember = { kind: 'region', region: loopRegion.id };
  const ambience: GroupMember = { kind: 'asset', asset: ambienceAsset.id };
  const footstep: GroupMember = { kind: 'asset', asset: footstepAsset.id };
  const state: GameAudioState = {
    groups: new Map(groups.map((group) => [group.id, group])),
    memberships: [
      {
        member: loop,
        group: grassId,
        processing: 'inherit',
        overrides: { naming: templates.member },
      },
      { member: ambience, group: footstepsId, processing: 'own', overrides: {} },
    ],
    scenarios: new Map(),
  };
  expectSuccess(validateGameAudioState(project, state));
  return { project, state, loop, ambience, footstep };
}

const PATHS = {
  sfx: ['SFX'],
  footsteps: ['SFX', 'Footsteps'],
  grass: ['SFX', 'Footsteps', 'Grass'],
};

describe('resolving a member’s policy (REQ-GAME-120)', () => {
  it('takes the override where the member sets one, hiding every group that sets the field, nearest first', () => {
    const { project, state, loop } = world();

    expect(resolvePolicy(project, state, loop).naming).toEqual({
      value: templates.member,
      source: { kind: 'override', member: loop },
      shadowed: [
        { group: footstepsId, value: templates.footsteps },
        { group: sfxId, value: templates.root },
      ],
    });
  });

  it('takes the nearest group that sets a field, naming it with its path', () => {
    const { project, state, loop } = world();
    const policy = resolvePolicy(project, state, loop);

    expect(policy.loudness).toEqual({
      value: quiet,
      source: { kind: 'group', group: grassId, path: PATHS.grass },
      shadowed: [{ group: sfxId, value: loud }],
    });
    expect(policy.bus).toEqual({
      value: sfxBus,
      source: { kind: 'group', group: footstepsId, path: PATHS.footsteps },
      shadowed: [],
    });
  });

  it('answers unset, with no value, where neither the member nor any group sets a field', () => {
    const { project, state, loop } = world();
    const policy = resolvePolicy(project, state, loop);

    expect(policy.destination).toEqual({
      value: undefined,
      source: { kind: 'unset' },
      shadowed: [],
    });
    expect(policy.exportProfile.source).toEqual({ kind: 'unset' });
  });

  it('resolves emitter rules over the groups alone, whoever plays the group holding them', () => {
    const { project, state, loop } = world();

    expect(resolvePolicy(project, state, loop).emitter).toEqual({
      value: emitter,
      source: { kind: 'group', group: sfxId, path: PATHS.sfx },
      shadowed: [],
    });
  });

  it('resolves processing over the groups, saying how the member stands against it', () => {
    const { project, state, loop, ambience } = world();

    // Grass sets none, hiding SFX's chain; the loop inherits, so it has no rack.
    expect(resolvePolicy(project, state, loop).processing).toEqual({
      value: 'none',
      source: { kind: 'group', group: grassId, path: PATHS.grass },
      shadowed: [{ group: sfxId, value: chainA }],
      membership: 'inherit',
      rack: undefined,
    });
    expect(resolvePolicy(project, state, ambience).processing).toEqual({
      value: chainA,
      source: { kind: 'group', group: sfxId, path: PATHS.sfx },
      shadowed: [],
      membership: 'own',
      rack: chainA,
    });
  });

  it('adds every ancestor’s tags to the region’s own, sorted, each with every source that gives it', () => {
    const { project, state, loop } = world();

    // The loop region is tagged footstep and gravel.
    expect(resolvePolicy(project, state, loop).tags).toEqual([
      {
        tag: 'footstep',
        from: [
          { kind: 'member' },
          { kind: 'group', group: footstepsId },
          { kind: 'group', group: sfxId },
        ],
      },
      { tag: 'gravel', from: [{ kind: 'member' }] },
      { tag: 'sfx', from: [{ kind: 'group', group: sfxId }] },
    ]);
  });

  it('gives a member in no group every field unset and only its own tags', () => {
    const { project, state, footstep } = world();
    const policy = resolvePolicy(project, state, footstep);
    const unset = { value: undefined, source: { kind: 'unset' }, shadowed: [] };

    expect(policy).toEqual({
      member: footstep,
      group: undefined,
      processing: { ...unset, membership: undefined, rack: undefined },
      loudness: unset,
      exportProfile: unset,
      naming: unset,
      destination: unset,
      emitter: unset,
      variation: unset,
      bus: unset,
      tags: [],
    });
  });

  it('gives what a group’s members inherit, the group’s own settings included', () => {
    const { state } = world();
    const footsteps = resolveGroupPolicy(state, footstepsId);

    expect(footsteps.group).toBe(footstepsId);
    expect(footsteps.fields.naming).toEqual({
      value: templates.footsteps,
      source: { kind: 'group', group: footstepsId, path: PATHS.footsteps },
      shadowed: [{ group: sfxId, value: templates.root }],
    });
    expect(footsteps.fields.loudness.source).toEqual({
      kind: 'group',
      group: sfxId,
      path: PATHS.sfx,
    });
    expect(footsteps.tags).toEqual([
      {
        tag: 'footstep',
        from: [
          { kind: 'group', group: footstepsId },
          { kind: 'group', group: sfxId },
        ],
      },
      { tag: 'sfx', from: [{ kind: 'group', group: sfxId }] },
    ]);
  });

  it('resolves every member at once, by key, as one at a time does', () => {
    const { project, state, loop, ambience } = world();
    const all = resolveAll(project, state);

    expect([...all.keys()]).toEqual([memberKey(loop), memberKey(ambience)]);
    expect(all.get(memberKey(loop))).toEqual(resolvePolicy(project, state, loop));
    expect(all.get(memberKey(ambience))).toEqual(resolvePolicy(project, state, ambience));
  });

  it('refuses to resolve a forest the validator would refuse, rather than answer from part of it', () => {
    const { project, state, loop } = world();
    const sfx = state.groups.get(sfxId);
    if (sfx === undefined) throw new Error('The fixture has SFX.');
    const cyclic: GameAudioState = {
      ...state,
      groups: new Map(state.groups).set(sfxId, { ...sfx, parent: grassId }),
    };

    expect(() => resolvePolicy(project, cyclic, loop)).toThrow(/own ancestor/);
  });
});

describe('member keys', () => {
  it('tell a region from an asset of the same identifier', () => {
    expect(memberKey({ kind: 'region', region: 'same' as RegionId })).toBe('region:same');
    expect(memberKey({ kind: 'asset', asset: 'same' as AssetId })).toBe('asset:same');
  });
});
