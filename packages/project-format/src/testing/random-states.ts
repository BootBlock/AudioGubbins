/**
 * Random valid project states from a seed, for the property tests.
 *
 * Deterministic: one seed always gives one state, so a failing case is found
 * again by its seed. Every entity kind appears in random numbers with valid
 * references, numbers range from the tiny to the huge, and each asset comes
 * with a source from `random-values.ts`, so the aggregate's invariants hold.
 * Assets carry small chains of edits, and regions and markers are anchored on
 * them, from `random-edits.ts`.
 */

import {
  MAIN_OUTPUT,
  createDeterministicIdGenerator,
  SummingLaw,
  createProject,
  instantiateProcessor,
  routeToBus,
  sampleRate,
  type Asset,
  type AssetId,
  type Bus,
  type BusId,
  type Clip,
  type ClipId,
  type EffectChain,
  type EffectChainId,
  type IdGenerator,
  type ChainSlot,
  type ParallelGroup,
  type ParameterId,
  type ParameterValue,
  type PlanContext,
  type ProcessorInstance,
  type ProjectId,
  type Track,
  type TrackId,
} from '@audiogubbins/domain';
import { expectSuccess, TEST_CATALOGUE, TEST_ENGINE } from '@audiogubbins/domain/testing';

import type { AssetSource, ProjectState } from '../project-state.js';
import { randomMarker, randomRegion, withRandomEdits } from './random-edits.js';
import {
  RATES,
  maybe,
  randomAssetRecord,
  randomCount,
  randomLayout,
  randomHeldName,
  randomName,
  seededRandom,
  type Random,
} from './random-values.js';

const NUMBERS = [0, 1, 0.5, 1e21, 5e-324, 123.456, 2 ** 53 - 1, 1e-7, 0.1 + 0.2];

/** A random valid project state. */
export function randomState(seed: number): ProjectState {
  const random = seededRandom(seed);
  const ids = createDeterministicIdGenerator(seed);
  const build = new StateBuilder(random, ids);
  return build.state();
}

/** A random chain, as a random state's chains are made (`StateBuilder.chain`). */
export function randomChain(random: Random, ids: IdGenerator): EffectChain {
  return new StateBuilder(random, ids).chain();
}

/** Builds one random state; each method adds one kind of entity. */
class StateBuilder {
  private readonly random: Random;
  private readonly ids: IdGenerator;

  constructor(random: Random, ids: IdGenerator) {
    this.random = random;
    this.ids = ids;
  }

  state(): ProjectState {
    const projectId = this.ids.next<'ProjectId'>();
    const chains = this.entities(4, () => this.chain());
    const chainIds = [...chains.keys()];
    const buses = this.buses(chainIds);
    const busIds = [...buses.keys()];
    const tracks = this.entities(5, () => this.track(busIds, chainIds));
    const context = { chains, catalogue: TEST_CATALOGUE, engine: TEST_ENGINE };
    const { assets, sources } = this.assets(projectId, context);
    const placedOn = [...assets.values()];
    const trackIds = [...tracks.keys()];
    const clips =
      trackIds.length > 0 && assets.size > 0
        ? this.entities(8, () => this.clip(trackIds, [...assets.values()]))
        : new Map<ClipId, Clip>();

    const project = {
      ...createProject(projectId, randomHeldName(this.random), {
        sampleRate: expectSuccess(sampleRate(this.random.pick(RATES))),
        channelLayout: randomLayout(this.random),
      }),
      assets,
      tracks,
      buses,
      clips,
      regions: this.placed(placedOn, 4, (random, ids, asset) =>
        randomRegion(random, ids, asset, context),
      ),
      markers: this.placed(placedOn, 4, randomMarker),
      effectChains: chains,
      trackOrder: this.shuffled(trackIds),
    };
    return { project, sources };
  }

  /** Up to five assets, each with its source and a small chain of edits. */
  private assets(
    projectId: ProjectId,
    context: PlanContext,
  ): {
    readonly assets: Map<AssetId, Asset>;
    readonly sources: Map<AssetId, AssetSource>;
  } {
    const assets = new Map<AssetId, Asset>();
    const sources = new Map<AssetId, AssetSource>();
    for (let count = this.random.below(6); count > 0; count -= 1) {
      const { asset, source } = randomAssetRecord(this.random, this.ids, projectId);
      assets.set(asset.id, asset);
      sources.set(asset.id, source);
    }
    return { assets: withRandomEdits(this.random, this.ids, assets, context), sources };
  }

  private entities<TEntity extends { readonly id: string }>(
    most: number,
    make: () => TEntity,
  ): Map<TEntity['id'], TEntity> {
    const entities = new Map<TEntity['id'], TEntity>();
    const count = this.random.below(most + 1);
    for (let index = 0; index < count; index += 1) {
      const entity = make();
      entities.set(entity.id, entity);
    }
    return entities;
  }

  private shuffled<TItem>(items: readonly TItem[]): TItem[] {
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const other = this.random.below(index + 1);
      const held = shuffled[index];
      const swapped = shuffled[other];
      if (held === undefined || swapped === undefined) throw new Error('Shuffled out of range.');
      shuffled[index] = swapped;
      shuffled[other] = held;
    }
    return shuffled;
  }

  private parameterValue(): ParameterValue {
    switch (this.random.below(3)) {
      case 0:
        return this.random.pick(NUMBERS) * (this.random.chance(0.3) ? -1 : 1) || 0;
      case 1:
        return randomName(this.random);
      default:
        return this.random.chance(0.5);
    }
  }

  /**
   * A chain of up to four slots: processors of the test catalogue made as a
   * command makes them, so a plan can run them, and processors of types and
   * values no build has, which a document still holds as they are; groups of
   * up to three branches, nested twice.
   */
  chain(): EffectChain {
    return { id: this.ids.next<'EffectChainId'>(), slots: this.slots(0) };
  }

  private slots(depth: number): ChainSlot[] {
    return Array.from({ length: this.random.below(depth === 0 ? 5 : 3) }, () =>
      depth < 2 && this.random.chance(0.2) ? this.group(depth) : this.processor(),
    );
  }

  private controls(): { enabled: boolean; soloed: boolean; mix: number } {
    return {
      enabled: this.random.chance(0.7),
      soloed: this.random.chance(0.2),
      mix: this.random.pick([0, 0.25, 0.5, 1, 0.1 + 0.2]),
    };
  }

  private group(depth: number): ParallelGroup {
    return {
      kind: 'group',
      id: this.ids.next<'ProcessorGroupId'>(),
      ...this.controls(),
      summing: this.random.pick(Object.values(SummingLaw)),
      branches: Array.from({ length: 1 + this.random.below(3) }, () => ({
        slots: this.slots(depth + 1),
      })),
    };
  }

  private processor(): ProcessorInstance {
    const id = this.ids.next<'ProcessorId'>();
    if (this.random.chance(0.5)) {
      const descriptor = this.random.pick([...TEST_CATALOGUE.values()]);
      return { ...instantiateProcessor(id, descriptor), ...this.controls(), mix: 1 };
    }
    const model = maybe(this.random, () => ({
      pack: 'deepfilternet-3',
      version: '3.0.0',
      modelHash: 'a'.repeat(64),
      runtimeHash: 'b'.repeat(64),
    }));
    const resampler = maybe(this.random, () => this.random.below(4));
    const state = maybe(this.random, () => ({
      kind: 'noise-profile',
      values: Array.from({ length: this.random.below(6) }, () => this.random.pick(NUMBERS)),
    }));
    return {
      kind: 'processor',
      id,
      typeKey: this.random.pick(['parametric-eq', 'compressor', 'gate:v2', 'Reverb.Plate']),
      ...this.controls(),
      version: {
        implementation: this.random.below(4),
        parameters: this.random.below(4),
        ...(resampler === undefined ? {} : { resampler }),
        ...(model === undefined ? {} : { model }),
      },
      values: new Map<ParameterId, ParameterValue>(
        Array.from({ length: this.random.below(4) }, () => [
          this.ids.next<'ParameterId'>(),
          this.parameterValue(),
        ]),
      ),
      ...(state === undefined ? {} : { state }),
    };
  }

  /** Buses, each sending to the main output or to a bus made before it, so no send loops. */
  private buses(chainIds: readonly EffectChainId[]): Map<BusId, Bus> {
    const buses = new Map<BusId, Bus>();
    const count = this.random.below(5);
    for (let index = 0; index < count; index += 1) {
      const earlier = [...buses.keys()];
      const output = this.random.chance(0.3)
        ? undefined
        : earlier.length > 0 && this.random.chance(0.5)
          ? routeToBus(this.random.pick(earlier))
          : MAIN_OUTPUT;
      const chainId =
        chainIds.length > 0 ? maybe(this.random, () => this.random.pick(chainIds)) : undefined;
      const bus: Bus = {
        id: this.ids.next<'BusId'>(),
        displayName: randomName(this.random),
        channelLayout: randomLayout(this.random),
        gain: this.random.pick(NUMBERS),
        muted: this.random.chance(0.2),
        ...(output === undefined ? {} : { output }),
        ...(chainId === undefined ? {} : { effectChainId: chainId }),
      };
      buses.set(bus.id, bus);
    }
    return buses;
  }

  private track(busIds: readonly BusId[], chainIds: readonly EffectChainId[]): Track {
    const chainId =
      chainIds.length > 0 ? maybe(this.random, () => this.random.pick(chainIds)) : undefined;
    const paletteKey = maybe(this.random, () => this.random.pick(['teal', 'amber', 'violet-2']));
    return {
      id: this.ids.next<'TrackId'>(),
      displayName: randomName(this.random),
      channelLayout: randomLayout(this.random),
      gain: this.random.pick(NUMBERS),
      pan: this.random.pick([-1, -0.25, 0, 0.5, 1]),
      muted: this.random.chance(0.2),
      soloed: this.random.chance(0.2),
      output:
        busIds.length > 0 && this.random.chance(0.5)
          ? routeToBus(this.random.pick(busIds))
          : MAIN_OUTPUT,
      ...(chainId === undefined ? {} : { effectChainId: chainId }),
      ...(paletteKey === undefined ? {} : { paletteKey }),
    };
  }

  private clip(trackIds: readonly TrackId[], assets: readonly Asset[]): Clip {
    const asset = this.random.pick(assets);
    const start = randomCount(this.random, asset.length);
    const length = randomCount(this.random, asset.length - start);
    const fadeIn = randomCount(this.random, length);
    const fadeOut = randomCount(this.random, length - fadeIn);
    return {
      id: this.ids.next<'ClipId'>(),
      trackId: this.random.pick(trackIds),
      displayName: randomName(this.random),
      source: { assetId: asset.id, start, length },
      timelineStart: randomCount(this.random, 100_000_000),
      timelineLength: length,
      gain: this.random.pick(NUMBERS),
      fadeInLength: fadeIn,
      fadeOutLength: fadeOut,
      muted: this.random.chance(0.2),
    };
  }

  /** Up to `most` values on random assets, as `make` places one, where it can. */
  private placed<TEntity extends { readonly id: string }>(
    assets: readonly Asset[],
    most: number,
    make: (random: Random, ids: IdGenerator, asset: Asset) => TEntity | undefined,
  ): Map<TEntity['id'], TEntity> {
    const entities = new Map<TEntity['id'], TEntity>();
    if (assets.length === 0) return entities;
    for (let count = this.random.below(most + 1); count > 0; count -= 1) {
      const entity = make(this.random, this.ids, this.random.pick(assets));
      if (entity !== undefined) entities.set(entity.id, entity);
    }
    return entities;
  }
}
