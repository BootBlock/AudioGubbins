/**
 * Project states for tests, built so they satisfy the aggregate's invariants:
 * every asset has a source and the storage key its source gives.
 *
 * The fixtures package's sample project holds assets keyed `fixture:...`, which
 * no source gives, so a state is built from it by attaching a source to each
 * asset and deriving the key, never by writing a key by hand. The test passes
 * the sample project in, because only a test may take the fixtures package.
 */

import {
  FadeDirection,
  FadeShape,
  MAIN_OUTPUT,
  MaskEffect,
  NO_FEATHER,
  StandardLayouts,
  assetPlan,
  derivedSampleCount,
  routeToBus,
  sampleRate,
  slicePlan,
  type Asset,
  type AssetId,
  type Bus,
  type EditOperation,
  type EditRange,
  type EffectChain,
  type EffectChainId,
  type IdGenerator,
  type ParameterId,
  type ParameterValue,
  type Project,
  type Region,
  type RegionOperation,
  type Track,
} from '@audiogubbins/domain';
import {
  deepestChain,
  expectSuccess,
  PLAN_WITHOUT_CHAINS,
  TEST_CATALOGUE,
  TEST_ENGINE,
} from '@audiogubbins/domain/testing';

import {
  busName,
  destinationPath,
  namingTemplate,
  profileFromPreset,
  validateGameAudioState,
  type GameAssetGroup,
  type GameAudioState,
  type GamePreviewScenario,
  type GroupMember,
} from '@audiogubbins/game-audio';
import { BUILT_IN_PRESETS } from '@audiogubbins/import-export';

import { contentIdFrom, type ContentId } from '../content-identity.js';
import {
  SourceChangePolicy,
  storageKeyOf,
  withGameAudio,
  type AssetSource,
  type ProjectState,
} from '../project-state.js';

/** A content identifier made of one hexadecimal digit repeated. */
export function contentIdOfDigit(digit: string): ContentId {
  return expectSuccess(contentIdFrom(`c1-${digit.repeat(64)}`));
}

/** The project with a source attached to each asset and its storage key derived. */
export function withSources(
  project: Project,
  sourceOf: (asset: Asset, index: number) => AssetSource,
): ProjectState {
  const assets = new Map<AssetId, Asset>();
  const sources = new Map<AssetId, AssetSource>();
  [...project.assets.values()].forEach((asset, index) => {
    const source = sourceOf(asset, index);
    assets.set(asset.id, { ...asset, storageKey: storageKeyOf(asset.id, source.media) });
    sources.set(asset.id, source);
  });
  return { project: { ...project, assets }, sources };
}

/**
 * What a reference state is built from: the fixtures package's sample project,
 * its identifier generator, and the assets and tracks it names.
 */
export interface SampleProject {
  readonly project: Project;
  readonly ids: IdGenerator;
  readonly assets: { readonly footstep: Asset; readonly ambience: Asset };
  readonly tracks: { readonly foley: Track; readonly background: Track };
}

/**
 * The sample project with one of every kind of thing a state holds: a bus with
 * an effect chain, a track routed through it, a managed source and an external
 * one frozen on a retained copy, each with its provenance.
 */
export function referenceState(fixture: SampleProject): ProjectState {
  const { ids, project } = fixture;

  const chain: EffectChain = {
    id: ids.next<'EffectChainId'>(),
    slots: [
      {
        kind: 'processor',
        id: ids.next<'ProcessorId'>(),
        typeKey: 'parametric-eq',
        enabled: true,
        soloed: false,
        mix: 1,
        version: { implementation: 1, parameters: 1 },
        values: new Map<ParameterId, ParameterValue>([
          [ids.next<'ParameterId'>(), 0.5],
          [ids.next<'ParameterId'>(), 'low-shelf'],
          [ids.next<'ParameterId'>(), true],
        ]),
      },
      {
        kind: 'group',
        id: ids.next<'ProcessorGroupId'>(),
        enabled: true,
        soloed: false,
        mix: 0.5,
        summing: 'equal-power',
        branches: [
          { slots: [] },
          {
            slots: [
              {
                kind: 'processor',
                id: ids.next<'ProcessorId'>(),
                typeKey: 'plate-reverb',
                enabled: false,
                soloed: false,
                mix: 0.25,
                version: { implementation: 2, parameters: 1, resampler: 1 },
                values: new Map<ParameterId, ParameterValue>([[ids.next<'ParameterId'>(), 1.5]]),
                state: { kind: 'impulse', values: [0.5, -0.25, 1e-7] },
              },
            ],
          },
        ],
      },
    ],
  };
  const bus: Bus = {
    id: ids.next<'BusId'>(),
    displayName: 'Reverb send',
    channelLayout: StandardLayouts.stereo,
    gain: 0.8,
    muted: false,
    output: MAIN_OUTPUT,
    effectChainId: chain.id,
  };
  const background = { ...fixture.tracks.background, output: routeToBus(bus.id) };

  return withSources(
    {
      ...project,
      tracks: new Map([
        [fixture.tracks.foley.id, fixture.tracks.foley],
        [background.id, background],
      ]),
      buses: new Map([[bus.id, bus]]),
      effectChains: new Map([[chain.id, chain]]),
    },
    (asset) =>
      asset.id === fixture.assets.footstep.id
        ? {
            media: {
              kind: 'managed',
              contentId: contentIdOfDigit('a'),
              byteLength: 48_044,
              mediaType: 'audio/wav',
            },
            provenance: {
              originalFileName: 'Gravel footstep.wav',
              importedAt: 1_790_000_000_000,
              sourceContentId: contentIdOfDigit('a'),
              byteLength: 48_044,
              mediaType: 'audio/wav',
              originProjectId: project.id,
              audio: {
                container: 'wav',
                sampleRate: asset.sampleRate,
                encoding: { kind: 'integer', bits: 16, byteOrder: 'little' },
                frames: asset.length,
                declaredFrames: asset.length,
              },
            },
          }
        : {
            media: {
              kind: 'external',
              identity: {
                handleKey: 'handle-0001',
                fileName: 'Forest ambience.flac',
                relativePath: 'Ambience/Forest ambience.flac',
                byteLength: 1_234_567,
                lastModified: 1_780_000_000_000,
                mediaType: 'audio/flac',
                signature: '664c6143',
                fastFingerprint: 'b'.repeat(64),
              },
              policy: SourceChangePolicy.Freeze,
              retainedCopy: contentIdOfDigit('c'),
            },
            provenance: {
              originalFileName: 'Forest ambience.flac',
              importedAt: 1_790_000_100_000,
              sourceFingerprint: 'b'.repeat(64),
              byteLength: 1_234_567,
              mediaType: 'audio/flac',
              originProjectId: project.id,
            },
          },
  );
}

function span(start: number, end: number): EditRange {
  return { start: derivedSampleCount(start), end: derivedSampleCount(end) };
}

/**
 * The reference state with the edit model in it (ADR-0051): the footstep
 * carries a chain of every kind of operation, among them a paste whose plan
 * holds a gain stage and a conversion from mono to stereo, and the region on
 * it carries processing placed before and after that conversion.
 */
export function editedReferenceState(fixture: SampleProject): ProjectState {
  const state = referenceState(fixture);
  const { ids } = fixture;
  const footstep = state.project.assets.get(fixture.assets.footstep.id);
  if (footstep === undefined) throw new Error('The reference state has no footstep.');

  const louder: EditOperation = {
    id: ids.next<'EditOperationId'>(),
    kind: 'process',
    range: span(0, 12_000),
    channels: [0],
    edit: { kind: 'gain', gain: 0.5 },
  };
  const copied = slicePlan(
    expectSuccess(assetPlan({ ...footstep, edits: [louder] }, PLAN_WITHOUT_CHAINS)),
    6_000,
    18_000,
  );
  if (!copied.ok) throw new Error('The footstep could not be copied.');
  const edits: EditOperation[] = [
    louder,
    {
      id: ids.next<'EditOperationId'>(),
      kind: 'insert',
      at: derivedSampleCount(24_000),
      payload: copied.value,
    },
    {
      id: ids.next<'EditOperationId'>(),
      kind: 'convert-layout',
      layout: StandardLayouts.stereo,
      matrix: [[1], [-0.5]],
    },
    {
      id: ids.next<'EditOperationId'>(),
      kind: 'process',
      range: span(0, 2_400),
      edit: { kind: 'fade', direction: FadeDirection.In, shape: FadeShape.SCurve },
    },
    { id: ids.next<'EditOperationId'>(), kind: 'reverse', range: span(100, 200) },
    { id: ids.next<'EditOperationId'>(), kind: 'delete', range: span(30_000, 31_000) },
  ];
  const edited: Asset = { ...footstep, edits };

  const processing: RegionOperation[] = [
    {
      id: ids.next<'EditOperationId'>(),
      basis: 0,
      range: span(0, 1_000),
      edit: { kind: 'invert' },
    },
    {
      id: ids.next<'EditOperationId'>(),
      basis: 4,
      range: span(500, 1_500),
      edit: { kind: 'swap-channels', first: 0, second: 1 },
    },
    {
      id: ids.next<'EditOperationId'>(),
      basis: 5,
      range: span(0, 600),
      channels: [1],
      edit: { kind: 'gain', gain: 2 },
    },
    {
      id: ids.next<'EditOperationId'>(),
      basis: 6,
      range: span(0, 100),
      edit: { kind: 'channel-gains', gains: [1, 0.25] },
    },
  ];
  const regions = new Map(
    [...state.project.regions].map(([id, region]): [Region['id'], Region] => [
      id,
      region.assetId === footstep.id ? { ...region, operations: processing } : region,
    ]),
  );
  return {
    ...state,
    project: {
      ...state.project,
      assets: new Map([...state.project.assets, [footstep.id, edited]]),
      regions,
    },
  };
}

/**
 * A spectral edit that runs `chain` over a band of `start` to `end`: the
 * deepest thing a plan holds, since the plan carries the chain itself inside
 * the spectral edit inside its stream's processing (ADR-0081).
 */
export function chainedSpectralEdit(
  ids: IdGenerator,
  chain: EffectChainId,
  start: number,
  end: number,
): EditOperation {
  return {
    id: ids.next<'EditOperationId'>(),
    kind: 'process',
    range: { start: derivedSampleCount(start), end: derivedSampleCount(end) },
    edit: {
      kind: 'spectral',
      resolution: 1_024,
      operation: { kind: 'process', chain },
      mask: {
        shapes: [
          {
            kind: 'rectangle',
            effect: MaskEffect.Add,
            range: { start: derivedSampleCount(0), end: derivedSampleCount(end - start) },
            band: { low: 100, high: 4_000 },
          },
        ],
        feather: NO_FEATHER,
      },
    },
  };
}

/**
 * The reference state with the deepest chain the domain accepts in each place a
 * project keeps one: among the project's chains, as the footstep's rack, and in
 * the plan of a paste of the footstep's racked audio, processed by the chain
 * through a spectral edit, into the footstep, which nests the chain deepest of
 * all. Every reader of a whole project is pinned with it, so a depth bound
 * picked by hand rather than derived from the domain's is found.
 */
export function deeplyRackedState(fixture: SampleProject): ProjectState {
  const state = referenceState(fixture);
  const { ids } = fixture;
  const footstep = state.project.assets.get(fixture.assets.footstep.id);
  if (footstep === undefined) throw new Error('The reference state has no footstep.');

  const chain = deepestChain(ids);
  const chains = new Map([...state.project.effectChains, [chain.id, chain]]);
  const racked: Asset = {
    ...footstep,
    rack: chain.id,
    edits: [chainedSpectralEdit(ids, chain.id, 6_000, 18_000)],
  };
  const copied = expectSuccess(
    slicePlan(
      expectSuccess(
        assetPlan(racked, {
          chains,
          takeStacks: state.project.takeStacks,
          assets: state.project.assets,
          catalogue: TEST_CATALOGUE,
          engine: TEST_ENGINE,
        }),
      ),
      6_000,
      18_000,
    ),
  );
  const paste: EditOperation = {
    id: ids.next<'EditOperationId'>(),
    kind: 'insert',
    at: derivedSampleCount(24_000),
    payload: copied,
  };
  return {
    ...state,
    project: {
      ...state.project,
      assets: new Map([...state.project.assets, [footstep.id, { ...racked, edits: [paste] }]]),
      effectChains: chains,
    },
  };
}

/** What `groupedReferenceState` holds of its groups, for a test to name them. */
export interface GroupedReference {
  readonly state: ProjectState;

  /** The root group, which sets every field of its policy. */
  readonly outer: GameAssetGroup;

  /** The group inside it, which sets its bus and emitter rules alone. */
  readonly inner: GameAssetGroup;

  /** The chain the outer group's members inherit. */
  readonly chain: EffectChainId;

  /** The 3D scenario, which plays the inner group and the footstep, each part of a scenario in it. */
  readonly scenario: GamePreviewScenario;
}

/**
 * The reference state with asset groups (ADR-0101, ADR-0106): a root group that
 * sets every field of its policy, an export profile among them that makes every
 * choice a profile may, and a group inside it that sets its bus and emitter
 * rules; the sample's region in the inner group, inheriting its processing, so
 * its rack is the outer group's chain, and the footstep in the outer group with
 * processing of its own and an override of every field a member may override;
 * and two preview scenarios, a 3D one playing the inner group and the footstep,
 * with every kind of trigger, motion and subject and a bus level, and a 2D one
 * moving back and forth. Every reader and writer of the game-audio state is
 * pinned with it, so a member left out of one is found.
 */
export function groupedReferenceState(fixture: SampleProject): GroupedReference {
  const state = referenceState(fixture);
  const { ids } = fixture;
  const [chain] = state.project.effectChains.keys();
  const [region] = state.project.regions.values();
  const [preset] = BUILT_IN_PRESETS;
  if (chain === undefined || region === undefined || preset === undefined) {
    throw new Error('The reference state has a chain and a region, and a preset is built in.');
  }
  const rate = expectSuccess(sampleRate(48_000));
  const outer: GameAssetGroup = {
    id: ids.next<'GameAssetGroupId'>(),
    name: 'Footsteps',
    policy: {
      processing: chain,
      loudness: { integratedLufs: -16, toleranceLu: 1, truePeakCeilingDbtp: -1 },
      exportProfile: {
        format: 'flac',
        choices: {
          encoding: { bits: 24, compressionLevel: 5, keepRiffChunks: false },
          sampleRate: rate,
          channels: { kind: 'fold', to: StandardLayouts.mono },
          dither: { kind: 'triangular', amplitude: 1, shaping: 'first-order', seed: 7 },
          metadata: { policy: 'minimal', edits: [{ kind: 'set', key: 'artist', value: 'Foley' }] },
        },
      },
      naming: expectSuccess(namingTemplate('{group:snake}_{number:2}')),
      destination: expectSuccess(destinationPath(['audio', 'sfx'])),
      emitter: {
        selection: { kind: 'uniform' },
        voices: { limit: 4, stealing: 'quietest' },
        cooldownMilliseconds: 120,
        attenuation: { kind: 'inverse', unitSize: 1, maxDistance: 40, ceilingDecibels: 3 },
        filter: { cutoffHertz: 5_000, decibels: -24 },
      },
      variation: {
        pitchCents: { min: -200, max: 150 },
        gainDecibels: { min: -3, max: 0 },
        startOffsetMilliseconds: { max: 20 },
      },
      bus: expectSuccess(busName('SFX')),
      tags: ['footstep', 'gravel'],
    },
  };
  const inner: GameAssetGroup = {
    id: ids.next<'GameAssetGroupId'>(),
    name: 'Grass',
    parent: outer.id,
    policy: {
      bus: expectSuccess(busName('Foley')),
      emitter: {
        selection: { kind: 'avoid-recent', depth: 2 },
        voices: { limit: 2, stealing: 'reject' },
        cooldownMilliseconds: 0,
        attenuation: { kind: 'exponent', maxDistance: 25, exponent: 1.5 },
      },
    },
  };
  const footstep: GroupMember = { kind: 'asset', asset: fixture.assets.footstep.id };
  const game: GameAudioState = {
    groups: new Map([
      [outer.id, outer],
      [inner.id, inner],
    ]),
    memberships: [
      {
        member: { kind: 'region', region: region.id },
        group: inner.id,
        processing: 'inherit',
        overrides: {},
      },
      {
        member: footstep,
        group: outer.id,
        processing: 'own',
        overrides: {
          loudness: { integratedLufs: -18, toleranceLu: 2 },
          exportProfile: profileFromPreset(preset),
          naming: expectSuccess(namingTemplate('{asset:kebab}')),
          destination: expectSuccess(destinationPath(['ui'])),
          variation: {
            pitchCents: { min: 0, max: 0 },
            gainDecibels: { min: -6, max: -6 },
            startOffsetMilliseconds: { max: 0 },
          },
          bus: expectSuccess(busName('UI')),
        },
      },
    ],
    scenarios: new Map(),
  };
  const scenario: GamePreviewScenario = {
    id: ids.next<'GamePreviewScenarioId'>(),
    name: 'Corridor',
    space: '3d',
    panWidth: 1_152,
    panningStrength: 0.5,
    listener: { at: { x: 0.5, y: 1.75, z: -2.25 }, facingTurns: 0.125 },
    emitters: [
      {
        id: ids.next<'PreviewEmitterId'>(),
        name: 'Walker',
        subject: { kind: 'group', group: inner.id },
        trigger: { kind: 'repeat', intervalMilliseconds: 450, jitterMilliseconds: 30, count: 40 },
        motion: {
          kind: 'waypoints',
          points: [
            { at: { x: -4, y: 0, z: -3 }, milliseconds: 0 },
            { at: { x: 4, y: 0, z: -3.5 }, milliseconds: 6_000 },
            { at: { x: -4, y: 0, z: -3 }, milliseconds: 12_000 },
          ],
          repeat: 'loop',
        },
      },
      {
        id: ids.next<'PreviewEmitterId'>(),
        name: 'Door',
        subject: { kind: 'member', member: footstep },
        trigger: { kind: 'by-hand' },
        motion: { kind: 'still', at: { x: 2, y: 0.25, z: 1.5 } },
      },
    ],
    seed: 4_294_967_295,
    busLevels: [{ bus: expectSuccess(busName('SFX')), decibels: -4.5 }],
  };
  const flat: GamePreviewScenario = {
    id: ids.next<'GamePreviewScenarioId'>(),
    name: 'Side scroller',
    space: '2d',
    panWidth: 640,
    panningStrength: 1,
    listener: { at: { x: 0, y: 0, z: 0 }, facingTurns: 0 },
    emitters: [
      {
        id: ids.next<'PreviewEmitterId'>(),
        name: 'Patrol',
        subject: { kind: 'group', group: outer.id },
        trigger: { kind: 'repeat', intervalMilliseconds: 20, jitterMilliseconds: 0, count: 1 },
        motion: {
          kind: 'waypoints',
          points: [
            { at: { x: -300, y: 12, z: 0 }, milliseconds: 0 },
            { at: { x: 300, y: 12, z: 0 }, milliseconds: 10 },
          ],
          repeat: 'back-and-forth',
        },
      },
    ],
    seed: 0,
    busLevels: [],
  };
  const project: Project = {
    ...state.project,
    regions: new Map([...state.project.regions, [region.id, { ...region, rack: chain }]]),
  };
  const scenarios = new Map([
    [scenario.id, scenario],
    [flat.id, flat],
  ]);
  return {
    state: withGameAudio(
      { ...state, project },
      expectSuccess(validateGameAudioState(project, { ...game, scenarios })),
    ),
    outer,
    inner,
    chain,
    scenario,
  };
}
