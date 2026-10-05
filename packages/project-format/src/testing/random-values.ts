/**
 * Random values from a seed for the property tests: names, content
 * identifiers, channel layouts, and assets with their sources.
 *
 * Deterministic: one seed always gives one sequence, so a failing case is found
 * again by its seed. Names mix scripts, escapes, padding and a lone surrogate,
 * because a document may hold any of them and every reader and command must
 * give each back exactly. Sources are managed and external with every optional
 * member sometimes present, and each asset is keyed as its source gives.
 */

import {
  AmbisonicNormalisation,
  AmbisonicOrdering,
  AssetOrigin,
  StandardLayouts,
  ambisonicLayout,
  discreteLayout,
  labelledLayout,
  sampleCount,
  sampleRate,
  type Asset,
  type ChannelLayout,
  type IdGenerator,
  type ProjectId,
  type SampleCount,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import type { AssetRecord } from '../asset-record-json.js';
import { contentIdFrom, type ContentId } from '../content-identity.js';
import { writtenName } from '../given-names.js';
import {
  SOURCE_CONTAINERS,
  SourceChangePolicy,
  storageKeyOf,
  type AssetProvenance,
  type SourceAudioShape,
  type ExternalMedia,
  type ExternalSourceIdentity,
  type ManagedMedia,
  type MediaSource,
} from '../project-state.js';

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
  ' ',
  '\ud800',
  '10',
  '-',
];

/** Sample rates from the lowest to the highest a project takes. */
export const RATES = [8_000, 22_050, 44_100, 48_000, 96_000, 768_000];

const MEDIA_TYPES = ['audio/wav', 'audio/flac', 'audio/ogg', 'audio/mpeg'];
const HEX = '0123456789abcdef';

/** The value `make` gives, half the time. */
export function maybe<TValue>(random: Random, make: () => TValue): TValue | undefined {
  return random.chance(0.5) ? make() : undefined;
}

/** A random name of up to four pieces: sometimes blank, sometimes padded. */
export function randomName(random: Random): string {
  let name = '';
  const pieces = random.below(5);
  for (let index = 0; index < pieces; index += 1) name += random.pick(NAME_PIECES);
  return name;
}

/**
 * A random name a project or an asset holds: as {@link randomName}, sometimes
 * padded, but never blank, which the rule for such a name refuses.
 */
export function randomHeldName(random: Random): string {
  const name = randomName(random);
  return writtenName('asset', name).ok ? name : `${name}Footstep`;
}

/** A random count of samples, up to `most`. */
export function randomCount(random: Random, most: number): SampleCount {
  return expectSuccess(sampleCount(random.below(most + 1)));
}

/**
 * A random layout: mostly a standard one, and otherwise discrete channels, a
 * custom map whose labels name each channel, or an ambisonic set with its
 * convention, the two a layout states beyond its roles (ADR-0033).
 */
export function randomLayout(random: Random): ChannelLayout {
  if (random.chance(0.6)) return random.pick(Object.values(StandardLayouts));
  switch (random.below(3)) {
    case 0:
      return expectSuccess(discreteLayout(1 + random.below(12)));
    case 1:
      return expectSuccess(
        labelledLayout(
          Array.from({ length: 1 + random.below(6) }, (_, index) => `Stem ${String(index + 1)}`),
        ),
      );
    default:
      // The Furse-Malham order and weights go together, to the third order.
      return expectSuccess(
        ambisonicLayout(
          random.chance(0.5)
            ? {
                order: random.below(4),
                ordering: AmbisonicOrdering.FuMa,
                normalisation: AmbisonicNormalisation.FuMa,
              }
            : {
                order: random.below(8),
                ordering: AmbisonicOrdering.Acn,
                normalisation: random.pick([
                  AmbisonicNormalisation.Sn3d,
                  AmbisonicNormalisation.N3d,
                ]),
              },
        ),
      );
  }
}

function randomHex(random: Random, digits: number): string {
  let text = '';
  for (let index = 0; index < digits; index += 1) text += HEX.charAt(random.below(HEX.length));
  return text;
}

/** A random content identifier. */
export function randomContentId(random: Random): ContentId {
  return expectSuccess(contentIdFrom(`c1-${randomHex(random, 64)}`));
}

/** Random managed media. */
function randomManagedMedia(random: Random): ManagedMedia {
  return {
    kind: 'managed',
    contentId: randomContentId(random),
    byteLength: random.below(2 ** 40),
    mediaType: random.pick(MEDIA_TYPES),
  };
}

/** A random identity of an external file, each optional signal sometimes present. */
export function randomIdentity(random: Random): ExternalSourceIdentity {
  const handleKey = maybe(random, () => `handle-${randomHex(random, 8)}`);
  const fileName = maybe(random, () => `${randomHex(random, 6)} é 中.wav`);
  const relativePath = maybe(random, () => `Sounds/${randomHex(random, 4)}/take 1.wav`);
  const contentId = maybe(random, () => randomContentId(random));
  return {
    ...(handleKey === undefined ? {} : { handleKey }),
    ...(fileName === undefined ? {} : { fileName }),
    ...(relativePath === undefined ? {} : { relativePath }),
    byteLength: random.below(2 ** 40),
    lastModified: random.below(2 ** 42),
    mediaType: random.pick(MEDIA_TYPES),
    signature: randomHex(random, 2 * random.below(17)),
    fastFingerprint: randomHex(random, 64),
    ...(contentId === undefined ? {} : { contentId }),
  };
}

/** Random external media, with a retained copy whenever it is frozen. */
function randomExternalMedia(random: Random): ExternalMedia {
  const policy = random.pick(Object.values(SourceChangePolicy));
  const retainedCopy =
    policy === SourceChangePolicy.Freeze
      ? randomContentId(random)
      : maybe(random, () => randomContentId(random));
  return {
    kind: 'external',
    identity: randomIdentity(random),
    policy,
    ...(retainedCopy === undefined ? {} : { retainedCopy }),
  };
}

/** Random media, managed or external alike. */
export function randomMedia(random: Random): MediaSource {
  return random.chance(0.5) ? randomManagedMedia(random) : randomExternalMedia(random);
}

/**
 * A random asset and its source, the asset keyed as its source gives and its
 * provenance, where kept, mostly of the project `projectId`.
 */
export function randomAssetRecord(
  random: Random,
  ids: IdGenerator,
  projectId: ProjectId,
): AssetRecord {
  const id = ids.next<'AssetId'>();
  const media = randomMedia(random);
  const asset: Asset = {
    id,
    displayName: randomHeldName(random),
    origin: random.pick(Object.values(AssetOrigin)),
    sampleRate: expectSuccess(sampleRate(random.pick(RATES))),
    channelLayout: randomLayout(random),
    length: randomCount(random, 10_000_000),
    storageKey: storageKeyOf(id, media),
    edits: [],
  };
  const provenance = maybe(random, () => randomProvenance(random, ids, projectId, asset));
  return { asset, source: { media, ...(provenance === undefined ? {} : { provenance }) } };
}

function randomProvenance(
  random: Random,
  ids: IdGenerator,
  projectId: ProjectId,
  asset: Asset,
): AssetProvenance {
  const originalFileName = maybe(random, () => `${randomHex(random, 5)} ß.flac`);
  const sourceContentId = maybe(random, () => randomContentId(random));
  const sourceFingerprint = maybe(random, () => randomHex(random, 64));
  const audio = maybe(random, () => randomAudioShape(random, asset));
  return {
    ...(originalFileName === undefined ? {} : { originalFileName }),
    importedAt: random.below(2 ** 42),
    ...(sourceContentId === undefined ? {} : { sourceContentId }),
    ...(sourceFingerprint === undefined ? {} : { sourceFingerprint }),
    byteLength: random.below(2 ** 40),
    mediaType: random.pick(MEDIA_TYPES),
    originProjectId: random.chance(0.7) ? projectId : ids.next<'ProjectId'>(),
    ...(audio === undefined ? {} : { audio }),
  };
}

/**
 * The audio shape of the file an asset was imported from, agreeing with the
 * asset as the reader requires, and sometimes cut short of what it declared.
 */
function randomAudioShape(random: Random, asset: Asset): SourceAudioShape {
  const statedLayout = maybe(random, () => asset.channelLayout);
  const float = random.chance(0.3);
  return {
    container: random.pick(SOURCE_CONTAINERS),
    sampleRate: asset.sampleRate,
    encoding: float ? 'float' : 'integer',
    bitDepth: float ? random.pick([32, 64]) : random.pick([8, 12, 16, 20, 24, 32]),
    byteOrder: random.chance(0.5) ? 'little' : 'big',
    ...(statedLayout === undefined ? {} : { statedLayout }),
    frames: asset.length,
    declaredFrames: random.chance(0.8)
      ? asset.length
      : expectSuccess(sampleCount(asset.length + 1 + random.below(10_000))),
  };
}
