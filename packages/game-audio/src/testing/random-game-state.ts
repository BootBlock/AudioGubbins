/**
 * Random valid game-audio worlds from a seed, for the property tests of
 * resolution, validation and processing (REQ-GAME-120).
 *
 * Deterministic: a seed always gives one world, so a failing case is found
 * again by its seed. Draws come from the domain's counter draw, the one
 * generator of random numbers. A world is a project of assets, regions and
 * chains and a forest of groups over it: parents always made before their
 * children, so the forest is acyclic, with siblings named apart; every field of
 * a group's policy and of a member's overrides sometimes set, to a value the
 * field takes; members of both kinds, each in one group, inheriting or owning
 * their processing; and up to three preview scenarios playing its groups and
 * members (`random-scenarios.ts`).
 *
 * An `inherit` member's rack is the chain the generator itself carried down the
 * forest as it made each group, not one the resolver answers, so a test that
 * holds the resolver to a generated world holds it to an account made apart
 * from it.
 */

import {
  AssetOrigin,
  StandardLayouts,
  createDeterministicIdGenerator,
  createProject,
  sampleCount,
  sampleRate,
  type Asset,
  type EffectChain,
  type EffectChainId,
  type IdGenerator,
  type Project,
  type Region,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { BUILT_IN_PRESETS } from '@audiogubbins/import-export';

import { destinationPath } from '../export/destination-path.js';
import { profileFromPreset } from '../export/game-export-profile.js';
import { namingTemplate } from '../export/naming-template.js';
import type { GameAssetGroup } from '../groups/game-asset-group.js';
import type { GameAudioState } from '../groups/game-audio-state.js';
import type { GameAssetGroupId } from '../groups/group-ids.js';
import { memberKey, type GroupMember, type GroupMembership } from '../groups/membership.js';
import { busName } from '../policy/bus-name.js';
import type { InheritedPolicy, PolicyOverrides } from '../policy/inherited-policy.js';
import type {
  Attenuation,
  EmitterRules,
  SelectionRule,
  VoiceVariation,
} from '../policy/playback-rules.js';
import type { PolicyValues } from '../policy/policy-fields.js';
import type { PreviewSubject } from '../preview/preview-scenario.js';
import { randomScenario } from './random-scenarios.js';
import { seededRandom, type Random } from './seeded-random.js';

export interface GameWorld {
  readonly project: Project;
  readonly state: GameAudioState;
}

/** Names groups are made of: several scripts, a space inside, and case that siblings must not differ by alone. */
const NAME_PIECES = ['Footsteps', 'grass', 'Impacts', 'UI', 'Ωμέγα', '中文', 'Café', 'Wood Doors'];
const TAGS = ['footstep', 'gravel', 'wood', 'metal', 'ui', 'loud', 'Ωμέγα', 'loop'];
const TEMPLATES = [
  '{group:snake}_{number:2}',
  '{project}-{region:kebab}',
  '{group-path:pascal}{number}',
  '{asset:lower}_{date}',
];
const DESTINATIONS: readonly (readonly string[])[] = [[], ['audio'], ['audio', 'sfx'], ['ui']];
const BUSES = ['SFX', 'UI', 'Music', 'Ambience', 'Voice'];

/** How likely a group sets each field, and a member overrides each it may. */
const SETS = 0.4;

function randomSelection(random: Random): SelectionRule {
  return random.chance(0.5)
    ? { kind: 'uniform' }
    : { kind: 'avoid-recent', depth: random.whole(1, 16) };
}

/** A distance from which an emitter is silent, past `floor`; sometimes 0, no limit. */
function randomMaxDistance(random: Random, floor: number): number {
  return random.chance(0.2) ? 0 : floor + random.between(1, 500);
}

function randomAttenuation(random: Random): Attenuation {
  switch (random.below(3)) {
    case 0:
      return { kind: 'none' };
    case 1: {
      const unitSize = random.chance(0.1) ? 0.01 : random.between(0.5, 10);
      return {
        kind: random.pick(['inverse', 'inverse-square', 'logarithmic'] as const),
        unitSize,
        maxDistance: randomMaxDistance(random, unitSize),
        ceilingDecibels: random.between(-80, 24),
      };
    }
    default:
      return {
        kind: 'exponent',
        maxDistance: randomMaxDistance(random, 0),
        exponent: random.between(0.01, 16),
      };
  }
}

/** Random emitter rules the policy takes, every attenuation and distance among them. */
export function randomEmitterRules(random: Random): EmitterRules {
  const rules: EmitterRules = {
    selection: randomSelection(random),
    voices: {
      limit: random.whole(1, 64),
      stealing: random.pick(['oldest', 'quietest', 'reject'] as const),
    },
    cooldownMilliseconds: random.whole(0, 60_000),
    attenuation: randomAttenuation(random),
  };
  return random.chance(0.5)
    ? rules
    : {
        ...rules,
        filter: { cutoffHertz: random.between(20, 20_000), decibels: random.between(-80, 0) },
      };
}

/** A whole-number range within [lowest, highest], the least first. */
function wholeRange(random: Random, lowest: number, highest: number): { min: number; max: number } {
  const one = random.whole(lowest, highest);
  const other = random.whole(lowest, highest);
  return { min: Math.min(one, other), max: Math.max(one, other) };
}

function randomVariation(random: Random): VoiceVariation {
  return {
    pitchCents: wholeRange(random, -2_400, 2_400),
    gainDecibels: wholeRange(random, -60, 12),
    startOffsetMilliseconds: { max: random.whole(0, 10_000) },
  };
}

/** The values a field takes, one drawn each time, for every field a member may override. */
function overridableValues(random: Random) {
  return {
    loudness: (): PolicyValues['loudness'] => ({
      integratedLufs: random.between(-70, 0),
      toleranceLu: random.between(0.1, 6),
      ...(random.chance(0.5) ? { truePeakCeilingDbtp: random.between(-20, 0) } : {}),
    }),
    exportProfile: (): PolicyValues['exportProfile'] =>
      profileFromPreset(random.pick(BUILT_IN_PRESETS)),
    naming: (): PolicyValues['naming'] => expectSuccess(namingTemplate(random.pick(TEMPLATES))),
    destination: (): PolicyValues['destination'] =>
      expectSuccess(destinationPath(random.pick(DESTINATIONS))),
    variation: (): PolicyValues['variation'] => randomVariation(random),
    bus: (): PolicyValues['bus'] => expectSuccess(busName(random.pick(BUSES))),
  };
}

function randomOverrides(random: Random): PolicyOverrides {
  const values = overridableValues(random);
  return {
    ...(random.chance(SETS) ? { loudness: values.loudness() } : {}),
    ...(random.chance(SETS) ? { exportProfile: values.exportProfile() } : {}),
    ...(random.chance(SETS) ? { naming: values.naming() } : {}),
    ...(random.chance(SETS) ? { destination: values.destination() } : {}),
    ...(random.chance(SETS) ? { variation: values.variation() } : {}),
    ...(random.chance(SETS) ? { bus: values.bus() } : {}),
  };
}

function randomTags(random: Random): readonly string[] {
  return [...new Set(Array.from({ length: random.whole(1, 3) }, () => random.pick(TAGS)))];
}

function randomPolicy(random: Random, chains: readonly EffectChainId[]): InheritedPolicy {
  const processing: EffectChainId | 'none' | undefined = random.chance(SETS)
    ? random.chance(0.25) || chains.length === 0
      ? 'none'
      : random.pick(chains)
    : undefined;
  return {
    ...(processing === undefined ? {} : { processing }),
    ...randomOverrides(random),
    ...(random.chance(SETS) ? { emitter: randomEmitterRules(random) } : {}),
    ...(random.chance(SETS) ? { tags: randomTags(random) } : {}),
  };
}

/** An unedited asset of one second at 48 kHz, named `name`. */
export function worldAsset(ids: IdGenerator, name: string, rack?: EffectChainId): Asset {
  return {
    id: ids.next<'AssetId'>(),
    displayName: name,
    origin: AssetOrigin.Imported,
    sampleRate: expectSuccess(sampleRate(48_000)),
    channelLayout: StandardLayouts.stereo,
    length: expectSuccess(sampleCount(48_000)),
    storageKey: `world:${name}`,
    edits: [],
    ...(rack === undefined ? {} : { rack }),
  };
}

/** A region of the first half of `asset`, named `name`, with sorted `tags`. */
export function worldRegion(
  ids: IdGenerator,
  asset: Asset,
  name: string,
  tags: readonly string[] = [],
  rack?: EffectChainId,
): Region {
  return {
    id: ids.next<'RegionId'>(),
    assetId: asset.id,
    displayName: name,
    basis: 0,
    start: expectSuccess(sampleCount(0)),
    end: expectSuccess(sampleCount(24_000)),
    tags: tags.toSorted(),
    operations: [],
    ...(rack === undefined ? {} : { rack }),
  };
}

/** A project holding `parts`, each chain empty. */
export function worldProject(
  ids: IdGenerator,
  parts: {
    readonly assets: readonly Asset[];
    readonly regions?: readonly Region[];
    readonly chains?: readonly EffectChainId[];
  },
): Project {
  return {
    ...createProject(ids.next<'ProjectId'>(), 'World', {
      sampleRate: expectSuccess(sampleRate(48_000)),
      channelLayout: StandardLayouts.stereo,
    }),
    assets: new Map(parts.assets.map((asset) => [asset.id, asset])),
    regions: new Map((parts.regions ?? []).map((region) => [region.id, region])),
    effectChains: new Map(
      (parts.chains ?? []).map((id): [EffectChainId, EffectChain] => [id, { id, slots: [] }]),
    ),
  };
}

/** A group's name unique among its siblings, whatever case they differ by. */
function groupName(random: Random, index: number): string {
  return `${random.pick(NAME_PIECES)} ${String(index + 1)}`;
}

/** Groups made parents first, each with the chain an `inherit` member under it is given. */
function randomForest(
  random: Random,
  ids: IdGenerator,
  chains: readonly EffectChainId[],
): {
  readonly groups: readonly GameAssetGroup[];
  readonly racks: ReadonlyMap<GameAssetGroupId, EffectChainId | undefined>;
} {
  const groups: GameAssetGroup[] = [];
  const carried = new Map<GameAssetGroupId, EffectChainId | 'none' | undefined>();
  const count = random.whole(1, 12);
  for (let index = 0; index < count; index += 1) {
    const parent = groups.length > 0 && random.chance(0.7) ? random.pick(groups) : undefined;
    const group: GameAssetGroup = {
      id: ids.next<'GameAssetGroupId'>(),
      name: groupName(random, index),
      ...(parent === undefined ? {} : { parent: parent.id }),
      policy: randomPolicy(random, chains),
    };
    groups.push(group);
    carried.set(
      group.id,
      group.policy.processing ?? (parent === undefined ? undefined : carried.get(parent.id)),
    );
  }
  const racks = new Map(
    [...carried].map(([id, chain]) => [id, chain === 'none' ? undefined : chain] as const),
  );
  return { groups, racks };
}

/** A random valid world. */
export function randomGameWorld(seed: number): GameWorld {
  const random = seededRandom(seed);
  const ids = createDeterministicIdGenerator(seed);

  const chainIds = Array.from({ length: random.whole(0, 4) }, () => ids.next<'EffectChainId'>());
  const assets = Array.from({ length: random.whole(1, 3) }, (_, index) =>
    worldAsset(ids, `Sound ${String(index + 1)}`),
  );
  const regions = Array.from({ length: random.whole(0, 8) }, (_, index) =>
    worldRegion(
      ids,
      random.pick(assets),
      `Take ${String(index + 1)}`,
      random.chance(0.6) ? randomTags(random) : [],
    ),
  );
  const { groups, racks } = randomForest(random, ids, chainIds);

  const candidates: GroupMember[] = [
    ...regions.map((region): GroupMember => ({ kind: 'region', region: region.id })),
    ...assets.map((asset): GroupMember => ({ kind: 'asset', asset: asset.id })),
  ];
  const memberships: GroupMembership[] = candidates
    .filter(() => random.chance(0.75))
    .map((member) => ({
      member,
      group: random.pick(groups).id,
      processing: random.chance(0.6) ? 'inherit' : 'own',
      overrides: randomOverrides(random),
    }));
  // Shuffled, so assignment order is not the order the project holds them in.
  const shuffled = memberships
    .map((membership) => ({ membership, order: random.next() }))
    .toSorted((left, right) => left.order - right.order)
    .map(({ membership }) => membership);

  const rackOf = (member: GroupMember): EffectChainId | undefined => {
    const key = memberKey(member);
    const membership = shuffled.find((one) => memberKey(one.member) === key);
    if (membership?.processing === 'inherit') return racks.get(membership.group);
    // A member that owns its processing, or is in no group, keeps any rack or none.
    return random.chance(0.5) && chainIds.length > 0 ? random.pick(chainIds) : undefined;
  };
  const withRack = <T extends Asset | Region>(target: T, rack: EffectChainId | undefined): T =>
    rack === undefined ? target : { ...target, rack };

  const project = worldProject(ids, {
    assets: assets.map((asset) => withRack(asset, rackOf({ kind: 'asset', asset: asset.id }))),
    regions: regions.map((region) =>
      withRack(region, rackOf({ kind: 'region', region: region.id })),
    ),
    chains: chainIds,
  });
  // Drawn last, so a world's groups and members are the same with scenarios as without.
  const subjects: PreviewSubject[] = [
    ...groups.map((group): PreviewSubject => ({ kind: 'group', group: group.id })),
    ...shuffled.map(({ member }): PreviewSubject => ({ kind: 'member', member })),
  ];
  const scenarios = Array.from({ length: random.whole(0, 3) }, () =>
    randomScenario(random, ids, subjects),
  );
  return {
    project,
    state: {
      groups: new Map(groups.map((group) => [group.id, group])),
      memberships: shuffled,
      scenarios: new Map(scenarios.map((scenario) => [scenario.id, scenario])),
    },
  };
}
