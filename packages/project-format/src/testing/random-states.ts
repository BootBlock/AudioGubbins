/**
 * Random valid project states from a seed, for the property tests.
 *
 * Deterministic: one seed always gives one state, so a failing case is found
 * again by its seed. Every entity kind appears in random numbers with valid
 * references, numbers range from the tiny to the huge, and each asset comes
 * with a source from `random-values.ts`, so the aggregate's invariants hold.
 */

import {
  MAIN_OUTPUT,
  createDeterministicIdGenerator,
  createProject,
  routeToBus,
  sampleCount,
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
  type Marker,
  type ParameterId,
  type ParameterValue,
  type ProjectId,
  type Region,
  type Track,
  type TrackId,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import type { AssetSource, ProjectState } from '../project-state.js';
import {
  RATES,
  maybe,
  randomAssetRecord,
  randomCount,
  randomLayout,
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
    const { assets, sources } = this.assets(projectId);
    const trackIds = [...tracks.keys()];
    const clips =
      trackIds.length > 0 && assets.size > 0
        ? this.entities(8, () => this.clip(trackIds, [...assets.values()]))
        : new Map<ClipId, Clip>();

    const project = {
      ...createProject(projectId, randomName(this.random), {
        sampleRate: expectSuccess(sampleRate(this.random.pick(RATES))),
        channelLayout: randomLayout(this.random),
      }),
      assets,
      tracks,
      buses,
      clips,
      regions: this.entities(4, () => this.region()),
      markers: this.entities(4, () => this.marker()),
      effectChains: chains,
      trackOrder: this.shuffled(trackIds),
    };
    return { project, sources };
  }

  /** Up to five assets, each with its source. */
  private assets(projectId: ProjectId): {
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
    return { assets, sources };
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

  private chain(): EffectChain {
    const processors = Array.from({ length: this.random.below(4) }, () => ({
      id: this.ids.next<'ProcessorId'>(),
      typeKey: this.random.pick(['parametric-eq', 'compressor', 'gate:v2', 'Reverb.Plate']),
      enabled: this.random.chance(0.7),
      soloed: this.random.chance(0.2),
      values: new Map<ParameterId, ParameterValue>(
        Array.from({ length: this.random.below(4) }, () => [
          this.ids.next<'ParameterId'>(),
          this.parameterValue(),
        ]),
      ),
    }));
    return { id: this.ids.next<'EffectChainId'>(), processors };
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

  private region(): Region {
    const length = randomCount(this.random, 1_000_000);
    const tags = [
      ...new Set(Array.from({ length: this.random.below(4) }, () => randomName(this.random))),
    ].sort();
    const base = {
      id: this.ids.next<'RegionId'>(),
      displayName: randomName(this.random),
      start: randomCount(this.random, 100_000_000),
      length,
      tags,
    };
    if (length < 2 || this.random.chance(0.4)) return base;
    const loopStart = randomCount(this.random, length - 2);
    const loopEnd = expectSuccess(
      sampleCount(loopStart + 1 + this.random.below(length - loopStart)),
    );
    return {
      ...base,
      loop: { loopStart, loopEnd, crossfadeLength: randomCount(this.random, loopEnd - loopStart) },
    };
  }

  private marker(): Marker {
    const paletteKey = maybe(this.random, () => 'rose');
    return {
      id: this.ids.next<'MarkerId'>(),
      displayName: randomName(this.random),
      position: randomCount(this.random, 100_000_000),
      ...(paletteKey === undefined ? {} : { paletteKey }),
    };
  }
}
