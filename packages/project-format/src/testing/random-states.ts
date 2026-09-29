/**
 * Random valid project states from a seed, for the property tests.
 *
 * Deterministic: one seed always gives one state, so a failing case is found
 * again by its seed. Every entity kind appears in random numbers with valid
 * references, names mix scripts, escapes and a lone surrogate, numbers range
 * from the tiny to the huge, and sources are managed and external with every
 * optional member sometimes present.
 */

import {
  AssetOrigin,
  MAIN_OUTPUT,
  StandardLayouts,
  createDeterministicIdGenerator,
  createProject,
  discreteLayout,
  routeToBus,
  sampleCount,
  sampleRate,
  type Asset,
  type Bus,
  type BusId,
  type ChannelLayout,
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
  type SampleCount,
  type Track,
  type TrackId,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { contentIdFrom, type ContentId } from '../content-identity.js';
import {
  SourceChangePolicy,
  type AssetProvenance,
  type AssetSource,
  type ExternalSourceIdentity,
  type ProjectState,
} from '../project-state.js';
import { withSources } from './project-states.js';

/** A seeded source of numbers (mulberry32). */
export interface Random {
  /** A number in [0, 1). */
  next(): number;

  /** A whole number in [0, bound). */
  below(bound: number): number;

  /** One of the items. */
  pick<TItem>(items: readonly TItem[]): TItem;

  /** True with the given chance. */
  chance(probability: number): boolean;
}

/** A seeded source of numbers. */
export function seededRandom(seed: number): Random {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
  const below = (bound: number): number => Math.floor(next() * bound);
  return {
    next,
    below,
    pick: (items) => {
      const item = items[below(items.length)];
      if (item === undefined) throw new Error('Nothing to pick from.');
      return item;
    },
    chance: (probability) => next() < probability,
  };
}

/** Pieces names are made of: several scripts, escapes, an astral character and a lone surrogate. */
const NAME_PIECES = [
  'Footstep',
  ' ',
  'gravel',
  'é',
  'ß',
  '中文',
  'Ωμέγα',
  'עברית',
  '🎵',
  '"',
  '\\',
  '\n',
  '\t',
  '\u0001',
  ' ',
  '\ud800',
  '10',
  '-',
];

const RATES = [8_000, 22_050, 44_100, 48_000, 96_000, 768_000];
const NUMBERS = [0, 1, 0.5, 1e21, 5e-324, 123.456, 2 ** 53 - 1, 1e-7, 0.1 + 0.2];
const MEDIA_TYPES = ['audio/wav', 'audio/flac', 'audio/ogg', 'audio/mpeg'];
const HEX = '0123456789abcdef';

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
    const assets = this.entities(5, () => this.asset());
    const trackIds = [...tracks.keys()];
    const clips =
      trackIds.length > 0 && assets.size > 0
        ? this.entities(8, () => this.clip(trackIds, [...assets.values()]))
        : new Map<ClipId, Clip>();

    const project = {
      ...createProject(projectId, this.name(), {
        sampleRate: expectSuccess(sampleRate(this.random.pick(RATES))),
        channelLayout: this.layout(),
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
    return withSources(project, () => this.source(projectId));
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

  private name(): string {
    let name = '';
    const pieces = this.random.below(5);
    for (let index = 0; index < pieces; index += 1) name += this.random.pick(NAME_PIECES);
    return name;
  }

  private count(most: number): SampleCount {
    return expectSuccess(sampleCount(this.random.below(most + 1)));
  }

  private layout(): ChannelLayout {
    return this.random.chance(0.8)
      ? this.random.pick(Object.values(StandardLayouts))
      : expectSuccess(discreteLayout(1 + this.random.below(12)));
  }

  private hex(digits: number): string {
    let text = '';
    for (let index = 0; index < digits; index += 1)
      text += HEX.charAt(this.random.below(HEX.length));
    return text;
  }

  private contentId(): ContentId {
    return expectSuccess(contentIdFrom(`c1-${this.hex(64)}`));
  }

  private maybe<TValue>(make: () => TValue): TValue | undefined {
    return this.random.chance(0.5) ? make() : undefined;
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
        return this.name();
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
        chainIds.length > 0 ? this.maybe(() => this.random.pick(chainIds)) : undefined;
      const bus: Bus = {
        id: this.ids.next<'BusId'>(),
        displayName: this.name(),
        channelLayout: this.layout(),
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
    const chainId = chainIds.length > 0 ? this.maybe(() => this.random.pick(chainIds)) : undefined;
    const paletteKey = this.maybe(() => this.random.pick(['teal', 'amber', 'violet-2']));
    return {
      id: this.ids.next<'TrackId'>(),
      displayName: this.name(),
      channelLayout: this.layout(),
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

  private asset(): Asset {
    return {
      id: this.ids.next<'AssetId'>(),
      displayName: this.name(),
      origin: this.random.pick(Object.values(AssetOrigin)),
      sampleRate: expectSuccess(sampleRate(this.random.pick(RATES))),
      channelLayout: this.layout(),
      length: this.count(10_000_000),
      // Replaced by the key the asset's source gives.
      storageKey: '',
    };
  }

  private clip(trackIds: readonly TrackId[], assets: readonly Asset[]): Clip {
    const asset = this.random.pick(assets);
    const start = this.count(asset.length);
    const length = this.count(asset.length - start);
    const fadeIn = this.count(length);
    const fadeOut = this.count(length - fadeIn);
    return {
      id: this.ids.next<'ClipId'>(),
      trackId: this.random.pick(trackIds),
      displayName: this.name(),
      source: { assetId: asset.id, start, length },
      timelineStart: this.count(100_000_000),
      timelineLength: length,
      gain: this.random.pick(NUMBERS),
      fadeInLength: fadeIn,
      fadeOutLength: fadeOut,
      muted: this.random.chance(0.2),
    };
  }

  private region(): Region {
    const length = this.count(1_000_000);
    const tags = [
      ...new Set(Array.from({ length: this.random.below(4) }, () => this.name())),
    ].sort();
    const base = {
      id: this.ids.next<'RegionId'>(),
      displayName: this.name(),
      start: this.count(100_000_000),
      length,
      tags,
    };
    if (length < 2 || this.random.chance(0.4)) return base;
    const loopStart = this.count(length - 2);
    const loopEnd = expectSuccess(
      sampleCount(loopStart + 1 + this.random.below(length - loopStart)),
    );
    return {
      ...base,
      loop: { loopStart, loopEnd, crossfadeLength: this.count(loopEnd - loopStart) },
    };
  }

  private marker(): Marker {
    const paletteKey = this.maybe(() => 'rose');
    return {
      id: this.ids.next<'MarkerId'>(),
      displayName: this.name(),
      position: this.count(100_000_000),
      ...(paletteKey === undefined ? {} : { paletteKey }),
    };
  }

  private source(projectId: ProjectId): AssetSource {
    const media: AssetSource['media'] = this.random.chance(0.5)
      ? {
          kind: 'managed',
          contentId: this.contentId(),
          byteLength: this.random.below(2 ** 40),
          mediaType: this.random.pick(MEDIA_TYPES),
        }
      : this.external();
    const provenance = this.maybe(() => this.provenance(projectId));
    return { media, ...(provenance === undefined ? {} : { provenance }) };
  }

  private external(): AssetSource['media'] {
    const policy = this.random.pick(Object.values(SourceChangePolicy));
    const retainedCopy =
      policy === SourceChangePolicy.Freeze ? this.contentId() : this.maybe(() => this.contentId());
    const handleKey = this.maybe(() => `handle-${this.hex(8)}`);
    const fileName = this.maybe(() => `${this.hex(6)} é 中.wav`);
    const relativePath = this.maybe(() => `Sounds/${this.hex(4)}/take 1.wav`);
    const contentId = this.maybe(() => this.contentId());
    const identity: ExternalSourceIdentity = {
      ...(handleKey === undefined ? {} : { handleKey }),
      ...(fileName === undefined ? {} : { fileName }),
      ...(relativePath === undefined ? {} : { relativePath }),
      byteLength: this.random.below(2 ** 40),
      lastModified: this.random.below(2 ** 42),
      mediaType: this.random.pick(MEDIA_TYPES),
      signature: this.hex(2 * this.random.below(17)),
      fastFingerprint: this.hex(64),
      ...(contentId === undefined ? {} : { contentId }),
    };
    return {
      kind: 'external',
      identity,
      policy,
      ...(retainedCopy === undefined ? {} : { retainedCopy }),
    };
  }

  private provenance(projectId: ProjectId): AssetProvenance {
    const originalFileName = this.maybe(() => `${this.hex(5)} ß.flac`);
    const sourceContentId = this.maybe(() => this.contentId());
    const sourceFingerprint = this.maybe(() => this.hex(64));
    const bitDepth = this.maybe(() => this.random.pick([8, 16, 24, 32, 64]));
    return {
      ...(originalFileName === undefined ? {} : { originalFileName }),
      importedAt: this.random.below(2 ** 42),
      ...(sourceContentId === undefined ? {} : { sourceContentId }),
      ...(sourceFingerprint === undefined ? {} : { sourceFingerprint }),
      byteLength: this.random.below(2 ** 40),
      mediaType: this.random.pick(MEDIA_TYPES),
      originProjectId: this.random.chance(0.7) ? projectId : this.ids.next<'ProjectId'>(),
      ...(bitDepth === undefined ? {} : { bitDepth }),
    };
  }
}
