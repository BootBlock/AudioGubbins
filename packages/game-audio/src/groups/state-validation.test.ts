import { describe, expect, it } from 'vitest';

import {
  createDeterministicIdGenerator,
  type AssetId,
  type DomainFailure,
  type DomainResult,
  type EffectChainId,
  type Project,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import type { DestinationPath } from '../export/destination-path.js';
import type { NamingTemplate } from '../export/naming-template.js';
import type { BusName } from '../policy/bus-name.js';
import type { InheritedPolicy, PolicyOverrides } from '../policy/inherited-policy.js';
import { DEFAULT_EMITTER_RULES, DEFAULT_VOICE_VARIATION } from '../policy/playback-rules.js';
import type { GamePreviewScenario, PreviewSubject } from '../preview/preview-scenario.js';
import { repeatEmitter, vectorScenario } from '../testing/preview-vectors.js';
import { worldAsset, worldProject, worldRegion } from '../testing/random-game-state.js';
import type { GameAssetGroup } from './game-asset-group.js';
import type { GameAudioState } from './game-audio-state.js';
import type { GameAssetGroupId } from './group-ids.js';
import type { GroupMember, GroupMembership } from './membership.js';
import { validateGameAudioState } from './state-validation.js';

const chainA = 'chain-a' as EffectChainId;
const chainB = 'chain-b' as EffectChainId;
const sfx = 'group-sfx' as GameAssetGroupId;
const steps = 'group-steps' as GameAssetGroupId;

const ids = createDeterministicIdGenerator(11);
const footstepAsset = worldAsset(ids, 'Gravel footstep');
const plainRegion = worldRegion(ids, footstepAsset, 'Walk loop');
const BASE = worldProject(ids, {
  assets: [footstepAsset],
  regions: [plainRegion],
  chains: [chainA, chainB],
});
const region: GroupMember = { kind: 'region', region: plainRegion.id };
const asset: GroupMember = { kind: 'asset', asset: footstepAsset.id };

function group(
  id: GameAssetGroupId,
  name: string,
  extra: Partial<GameAssetGroup> = {},
): GameAssetGroup {
  return { id, name, policy: {}, ...extra };
}

/** SFX ⊃ Steps, each with the policy given, and the memberships given. */
function stateOf(
  memberships: readonly GroupMembership[] = [],
  policies: { readonly sfx?: InheritedPolicy; readonly steps?: InheritedPolicy } = {},
): GameAudioState {
  return {
    groups: new Map([
      [sfx, group(sfx, 'SFX', { policy: policies.sfx ?? {} })],
      [steps, group(steps, 'Steps', { parent: sfx, policy: policies.steps ?? {} })],
    ]),
    memberships,
    scenarios: new Map(),
  };
}

/** `region` with its rack set to `rack`, or none. */
function projectWithRack(rack: EffectChainId | undefined): Project {
  const { rack: _old, ...rest } = plainRegion;
  return {
    ...BASE,
    regions: new Map([[plainRegion.id, rack === undefined ? rest : { ...rest, rack }]]),
  };
}

function inRegion(
  processing: 'inherit' | 'own',
  overrides: PolicyOverrides = {},
  inGroup: GameAssetGroupId = steps,
): GroupMembership {
  return { member: region, group: inGroup, processing, overrides };
}

function failures(result: DomainResult<GameAudioState>): readonly DomainFailure[] {
  return result.ok ? [] : result.failures;
}

function codes(result: DomainResult<GameAudioState>): readonly string[] {
  return failures(result).map((one) => one.code);
}

/** The one failure of `code` in `result`. */
function only(result: DomainResult<GameAudioState>, code: string): DomainFailure {
  const found = failures(result).filter((one) => one.code === code);
  expect(found).toHaveLength(1);
  const [first] = found;
  if (first === undefined) throw new Error(`No ${code}.`);
  return first;
}

describe('a game-audio state’s forest (ADR-0101)', () => {
  it('passes a forest of named groups, with no member and no policy', () => {
    expect(expectSuccess(validateGameAudioState(BASE, stateOf()))).toEqual(stateOf());
  });

  it('refuses a parent that is no group, naming the group', () => {
    const state: GameAudioState = {
      groups: new Map([[steps, group(steps, 'Steps', { parent: 'gone' as GameAssetGroupId })]]),
      memberships: [],
      scenarios: new Map(),
    };
    const refusal = only(validateGameAudioState(BASE, state), 'game.group-parent-unknown');

    expect(refusal.details).toEqual({
      owner: 'group',
      group: steps,
      groupPath: 'Steps',
      parent: 'gone',
    });
    expect(refusal.summary).toBe(
      'The group "Steps" is inside group gone, which the project does not have.',
    );
  });

  it('refuses every group that is its own ancestor', () => {
    const state: GameAudioState = {
      groups: new Map([
        [sfx, group(sfx, 'SFX', { parent: steps })],
        [steps, group(steps, 'Steps', { parent: sfx })],
      ]),
      memberships: [],
      scenarios: new Map(),
    };
    const result = validateGameAudioState(BASE, state);

    expect(codes(result)).toEqual(['game.group-cycle', 'game.group-cycle']);
    expect(failures(result).map((one) => one.details?.['group'])).toEqual([sfx, steps]);
  });

  it('refuses a name that breaks the segment rule', () => {
    const state: GameAudioState = {
      groups: new Map([[sfx, group(sfx, 'SFX/Steps')]]),
      memberships: [],
      scenarios: new Map(),
    };
    const refusal = only(validateGameAudioState(BASE, state), 'game.group-name-invalid');

    expect(refusal.details).toEqual({ owner: 'group', group: sfx, groupPath: 'SFX/Steps' });
  });

  it('refuses two siblings, or two roots, whose names differ only in case', () => {
    const other = 'group-other' as GameAssetGroupId;
    const siblings: GameAudioState = {
      groups: new Map([...stateOf().groups, [other, group(other, 'STEPS', { parent: sfx })]]),
      memberships: [],
      scenarios: new Map(),
    };
    const roots: GameAudioState = {
      groups: new Map([...stateOf().groups, [other, group(other, 'sfx')]]),
      memberships: [],
      scenarios: new Map(),
    };

    const refusal = only(validateGameAudioState(BASE, siblings), 'game.group-name-taken');
    expect(refusal.details).toEqual({
      owner: 'group',
      group: other,
      groupPath: 'SFX/STEPS',
      other: steps,
    });
    expect(codes(validateGameAudioState(BASE, roots))).toEqual(['game.group-name-taken']);
  });

  it('takes one name under two parents', () => {
    const other = 'group-other' as GameAssetGroupId;
    const state: GameAudioState = {
      groups: new Map([...stateOf().groups, [other, group(other, 'Steps')]]),
      memberships: [],
      scenarios: new Map(),
    };
    expectSuccess(validateGameAudioState(BASE, state));
  });
});

describe('a game-audio state’s members', () => {
  it('refuses a member naming no region or asset of the project', () => {
    const ghost: GroupMember = { kind: 'asset', asset: 'ghost' as AssetId };
    const state = stateOf([{ member: ghost, group: steps, processing: 'own', overrides: {} }]);
    const refusal = only(validateGameAudioState(BASE, state), 'game.member-unknown');

    expect(refusal.details).toEqual({ owner: 'member', member: 'asset:ghost' });
  });

  it('refuses a member in two memberships', () => {
    const state = stateOf([inRegion('own'), inRegion('own', {}, sfx)]);
    const refusal = only(validateGameAudioState(BASE, state), 'game.member-twice');

    expect(refusal.summary).toBe('The region "Walk loop" is in more than one membership.');
  });

  it('refuses a membership naming no group', () => {
    const state = stateOf([inRegion('own', {}, 'gone' as GameAssetGroupId)]);
    const refusal = only(validateGameAudioState(BASE, state), 'game.member-group-unknown');

    expect(refusal.details).toEqual({
      owner: 'member',
      member: `region:${plainRegion.id}`,
      group: 'gone',
    });
  });

  it('takes an asset as a member as it does a region', () => {
    expectSuccess(
      validateGameAudioState(
        BASE,
        stateOf([{ member: asset, group: sfx, processing: 'own', overrides: {} }]),
      ),
    );
  });
});

describe('an inheriting member’s rack (one authority on processing)', () => {
  it('is the chain the nearest group that sets processing names', () => {
    const state = stateOf([inRegion('inherit')], { sfx: { processing: chainA } });

    expectSuccess(validateGameAudioState(projectWithRack(chainA), state));
    const refusal = only(
      validateGameAudioState(projectWithRack(chainB), state),
      'game.member-processing-mismatch',
    );
    expect(refusal.details).toEqual({
      owner: 'member',
      member: `region:${plainRegion.id}`,
      field: 'processing',
      rack: chainB,
      inherited: chainA,
      from: sfx,
    });
    expect(refusal.summary).toBe(
      'The region "Walk loop" inherits its processing, and the group "SFX" names chain chain-a, but its rack is chain chain-b.',
    );
  });

  it('is no rack where the nearest group sets none, hiding a chain further up', () => {
    const state = stateOf([inRegion('inherit')], {
      sfx: { processing: chainA },
      steps: { processing: 'none' },
    });

    expectSuccess(validateGameAudioState(projectWithRack(undefined), state));
    expect(codes(validateGameAudioState(projectWithRack(chainA), state))).toEqual([
      'game.member-processing-mismatch',
    ]);
  });

  it('is no rack where no group sets processing', () => {
    const state = stateOf([inRegion('inherit')]);

    expectSuccess(validateGameAudioState(projectWithRack(undefined), state));
    const refusal = only(
      validateGameAudioState(projectWithRack(chainA), state),
      'game.member-processing-mismatch',
    );
    expect(refusal.summary).toBe(
      'The region "Walk loop" inherits its processing, and no group sets its processing, but its rack is chain chain-a.',
    );
  });

  it('is any rack, or none, where the member owns its processing, one equal to its group’s included', () => {
    const state = stateOf([inRegion('own')], { sfx: { processing: chainA } });

    expectSuccess(validateGameAudioState(projectWithRack(chainA), state));
    expectSuccess(validateGameAudioState(projectWithRack(chainB), state));
    expectSuccess(validateGameAudioState(projectWithRack(undefined), state));
  });
});

describe('a policy’s values, each refusal naming its owner', () => {
  const badTemplate: NamingTemplate = { source: '{nope}', parts: [] };
  const badPath: DestinationPath = { segments: ['audio', '..'] };

  it('refuses a group’s processing naming no chain of the project', () => {
    const state = stateOf([], { steps: { processing: 'gone' as EffectChainId } });
    const refusal = only(validateGameAudioState(BASE, state), 'game.policy-chain-unknown');

    expect(refusal.details).toEqual({
      field: 'processing',
      owner: 'group',
      group: steps,
      groupPath: 'SFX/Steps',
    });
    expect(refusal.summary).toBe(
      'The group "SFX/Steps" sets its processing chain with what it does not take: the project has no chain gone.',
    );
  });

  it('refuses a naming template the game vocabulary does not read, with the template’s refusal as its cause', () => {
    const state = stateOf([], { sfx: { naming: badTemplate } });
    const refusal = only(validateGameAudioState(BASE, state), 'game.policy-naming-invalid');

    expect(refusal.details).toEqual({
      field: 'naming',
      owner: 'group',
      group: sfx,
      groupPath: 'SFX',
    });
    expect(refusal.cause?.code).toBe('game.naming-template-invalid');
    expect(refusal.summary).toContain(refusal.cause?.summary);
  });

  it('refuses a destination with a step out of its folder, with the destination’s refusal as its cause', () => {
    const state = stateOf([inRegion('own', { destination: badPath })]);
    const refusal = only(validateGameAudioState(BASE, state), 'game.policy-destination-invalid');

    expect(refusal.details).toEqual({
      field: 'destination',
      owner: 'member',
      member: `region:${plainRegion.id}`,
    });
    expect(refusal.cause?.code).toBe('game.destination-invalid');
    expect(refusal.summary).toMatch(
      /^The region "Walk loop" overrides its destination with what it does not take: /,
    );
  });

  it.each([
    [
      'loudness',
      { loudness: { integratedLufs: -80, toleranceLu: 1 } },
      'game.policy-loudness-invalid',
      'game.loudness-invalid',
    ],
    ['bus', { bus: '' as BusName }, 'game.policy-bus-invalid', 'game.bus-name-invalid'],
    [
      'variation',
      { variation: { ...DEFAULT_VOICE_VARIATION, pitchCents: { min: 10, max: -10 } } },
      'game.policy-variation-invalid',
      'game.variation-invalid',
    ],
  ] as const)('refuses a member’s %s override out of its rule', (field, overrides, code, cause) => {
    const refusal = only(validateGameAudioState(BASE, stateOf([inRegion('own', overrides)])), code);

    expect(refusal.details).toEqual({ field, owner: 'member', member: `region:${plainRegion.id}` });
    expect(refusal.cause?.code).toBe(cause);
  });

  it('refuses a group’s emitter rules out of their range', () => {
    const state = stateOf([], {
      sfx: { emitter: { ...DEFAULT_EMITTER_RULES, voices: { limit: 0, stealing: 'oldest' } } },
    });
    const refusal = only(validateGameAudioState(BASE, state), 'game.policy-emitter-invalid');

    expect(refusal.details?.['groupPath']).toBe('SFX');
    expect(refusal.cause?.details).toEqual({ part: 'voices.limit' });
  });

  it('refuses each tag empty, too long or holding a control character', () => {
    const state = stateOf([], {
      steps: { tags: ['ok', '', 'x'.repeat(65), 'a\u0007b', 'x'.repeat(64)] },
    });

    expect(codes(validateGameAudioState(BASE, state))).toEqual([
      'game.policy-tag-invalid',
      'game.policy-tag-invalid',
      'game.policy-tag-invalid',
    ]);
  });

  it('reports every problem at once, groups before members', () => {
    const state = stateOf([inRegion('own', { naming: badTemplate })], {
      sfx: { destination: badPath },
    });

    expect(codes(validateGameAudioState(BASE, state))).toEqual([
      'game.policy-destination-invalid',
      'game.policy-naming-invalid',
    ]);
  });
});

describe('a game-audio state’s preview scenarios (ADR-0104, ADR-0106)', () => {
  const BY_HAND = { kind: 'by-hand' } as const;

  /** A scenario whose emitters play `subjects`, one each. */
  function playing(...subjects: readonly PreviewSubject[]): GamePreviewScenario {
    return vectorScenario(
      subjects.map((subject, index) => repeatEmitter(index + 1, BY_HAND, { subject })),
      7,
    );
  }

  function withScenarios(state: GameAudioState, ...scenarios: GamePreviewScenario[]) {
    return { ...state, scenarios: new Map(scenarios.map((one) => [one.id, one])) };
  }

  // A scenario holds well-formed identifiers, which the forest's named ones are not.
  const played = 'abcd0000-0001' as GameAssetGroupId;
  const GROUPED: GameAudioState = {
    ...stateOf([inRegion('own')]),
    groups: new Map([...stateOf().groups, [played, group(played, 'Played')]]),
  };

  it('passes a scenario playing a group of the state and a member of one of its groups', () => {
    const state = withScenarios(
      GROUPED,
      playing({ kind: 'group', group: played }, { kind: 'member', member: region }),
    );
    expect(expectSuccess(validateGameAudioState(BASE, state))).toBe(state);
  });

  it('refuses an emitter playing a group the state lacks, naming the scenario and the emitter', () => {
    const scenario = playing({ kind: 'group', group: 'abcd0000-0099' as GameAssetGroupId });
    const refusal = only(
      validateGameAudioState(BASE, withScenarios(GROUPED, scenario)),
      'game.scenario-subject-unknown',
    );
    expect(refusal.details).toEqual({ scenario: scenario.id, part: 'emitters.0.subject' });
    expect(refusal.summary).toBe(
      'The emitter "Emitter 1" of the preview scenario "Vector" plays a group the project does not have.',
    );
  });

  it('refuses an emitter playing a sound of the project that is in no group', () => {
    const scenario = playing({ kind: 'member', member: asset });
    const refusal = only(
      validateGameAudioState(BASE, withScenarios(GROUPED, scenario)),
      'game.scenario-subject-unknown',
    );
    expect(refusal.summary).toContain('plays an asset that is in no group');
  });

  it('refuses a scenario held under an identifier not its own', () => {
    const scenario = playing({ kind: 'group', group: played });
    const other = vectorScenario(scenario.emitters, 7, {
      id: 'aaaa0000-0002' as GamePreviewScenario['id'],
    });
    const state = { ...GROUPED, scenarios: new Map([[other.id, scenario]]) };
    expect(codes(validateGameAudioState(BASE, state))).toEqual(['game.scenario-id-mismatch']);
  });

  it('refuses a scenario its own rules refuse, naming it', () => {
    const scenario = { ...playing({ kind: 'group', group: played }), seed: -1 };
    const refusal = only(
      validateGameAudioState(BASE, withScenarios(GROUPED, scenario)),
      'game.scenario-invalid',
    );
    expect(refusal.details).toEqual({ scenario: scenario.id, part: 'seed' });
  });
});
