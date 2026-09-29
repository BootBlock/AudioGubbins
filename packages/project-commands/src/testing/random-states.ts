/**
 * Seeded random project states, assets, sources and names for this package's
 * property tests, each satisfying the aggregate's invariants.
 *
 * The project format keeps a generator of its own, but offers no test entry
 * point another package may import, so the generator here is this package's.
 * Names mix scripts, padding, blanks, escapes and a lone surrogate, because an
 * older document may hold any of them and undo must give each back exactly.
 */

import {
  AssetOrigin,
  MAIN_OUTPUT,
  StandardLayouts,
  createDeterministicIdGenerator,
  createProject,
  sampleCount,
  sampleRate,
  type Asset,
  type AssetId,
  type Clip,
  type ClipId,
  type IdGenerator,
  type Track,
  type TrackId,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  SourceChangePolicy,
  contentIdFrom,
  storageKeyOf,
  type AssetSource,
  type ContentId,
  type ExternalMedia,
  type ExternalSourceIdentity,
  type ManagedMedia,
  type MediaSource,
  type ProjectState,
} from '@audiogubbins/project-format';

/** A seeded source of numbers (mulberry32). */
export interface Random {
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
    below,
    pick: (items) => {
      const item = items[below(items.length)];
      if (item === undefined) throw new Error('Nothing to pick from.');
      return item;
    },
    chance: (probability) => next() < probability,
  };
}

const NAME_PIECES = [
  'Forest',
  ' ',
  'gravel',
  'é',
  '中文',
  '🎵',
  '"',
  '\\',
  '\n',
  '\t',
  '\ud800',
  '10',
];
const MEDIA_TYPES = ['audio/wav', 'audio/flac', 'audio/ogg'];
const HEX = '0123456789abcdef';

/** A random name of up to four pieces: sometimes blank, sometimes padded. */
export function randomName(random: Random): string {
  let name = '';
  const pieces = random.below(5);
  for (let index = 0; index < pieces; index += 1) name += random.pick(NAME_PIECES);
  return name;
}

/** Random lower-case hexadecimal digits. */
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
export function randomManaged(random: Random): ManagedMedia {
  return {
    kind: 'managed',
    contentId: randomContentId(random),
    byteLength: random.below(2 ** 40),
    mediaType: random.pick(MEDIA_TYPES),
  };
}

/** A random identity of an external file, found through a kept handle. */
export function randomIdentity(random: Random): ExternalSourceIdentity {
  const relativePath = random.chance(0.5) ? `Sounds/${randomHex(random, 4)}.wav` : undefined;
  const contentId = random.chance(0.3) ? randomContentId(random) : undefined;
  return {
    handleKey: `handle-${randomHex(random, 8)}`,
    fileName: `${randomHex(random, 6)} é.wav`,
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
export function randomExternal(random: Random): ExternalMedia {
  const identity = randomIdentity(random);
  const policy = random.pick(Object.values(SourceChangePolicy));
  const retained =
    policy === SourceChangePolicy.Freeze || random.chance(0.5)
      ? (identity.contentId ?? randomContentId(random))
      : undefined;
  return {
    kind: 'external',
    identity,
    policy,
    ...(retained === undefined ? {} : { retainedCopy: retained }),
  };
}

/** A random asset and its source, the asset keyed as its source gives. */
export function randomAssetRecord(
  random: Random,
  ids: IdGenerator,
  projectId: ProjectState['project']['id'],
): { readonly asset: Asset; readonly source: AssetSource } {
  const media: MediaSource = random.chance(0.5) ? randomManaged(random) : randomExternal(random);
  const id = ids.next<'AssetId'>();
  const asset: Asset = {
    id,
    displayName: randomName(random),
    origin: random.pick(Object.values(AssetOrigin)),
    sampleRate: expectSuccess(sampleRate(random.pick([22_050, 44_100, 48_000]))),
    channelLayout: random.pick([StandardLayouts.mono, StandardLayouts.stereo]),
    length: expectSuccess(sampleCount(1 + random.below(10_000_000))),
    storageKey: storageKeyOf(id, media),
  };
  const provenance = random.chance(0.5)
    ? {
        originalFileName: 'Take 1.wav',
        importedAt: random.below(2 ** 42),
        byteLength: random.below(2 ** 40),
        mediaType: random.pick(MEDIA_TYPES),
        originProjectId: projectId,
        ...(random.chance(0.5) ? { bitDepth: random.pick([16, 24, 32]) } : {}),
      }
    : undefined;
  return { asset, source: { media, ...(provenance === undefined ? {} : { provenance }) } };
}

/**
 * A random valid state: a few assets, some used by clips on a track, and a
 * project named anything a document may hold.
 */
export function randomState(seed: number): ProjectState {
  const random = seededRandom(seed);
  const ids = createDeterministicIdGenerator(seed);
  const projectId = ids.next<'ProjectId'>();
  const base = createProject(projectId, randomName(random), {
    sampleRate: expectSuccess(sampleRate(48_000)),
    channelLayout: StandardLayouts.stereo,
  });

  const assets = new Map<AssetId, Asset>();
  const sources = new Map<AssetId, AssetSource>();
  for (let index = random.below(5); index > 0; index -= 1) {
    const { asset, source } = randomAssetRecord(random, ids, projectId);
    assets.set(asset.id, asset);
    sources.set(asset.id, source);
  }

  const track: Track = {
    id: ids.next<'TrackId'>(),
    displayName: randomName(random),
    channelLayout: StandardLayouts.stereo,
    gain: 1,
    pan: 0,
    muted: false,
    soloed: false,
    output: MAIN_OUTPUT,
  };
  const clips = new Map<ClipId, Clip>();
  for (const asset of assets.values()) {
    for (let count = random.below(3); count > 0 && random.chance(0.6); count -= 1) {
      const clip = clipOf(ids.next<'ClipId'>(), track.id, asset);
      clips.set(clip.id, clip);
    }
  }
  const tracks = new Map<TrackId, Track>([[track.id, track]]);
  return {
    project: { ...base, assets, tracks, clips, trackOrder: [track.id] },
    sources,
  };
}

/** A clip reading the whole of an asset from the start of the timeline. */
function clipOf(id: ClipId, trackId: TrackId, asset: Asset): Clip {
  return {
    id,
    trackId,
    displayName: 'Clip',
    source: { assetId: asset.id, start: expectSuccess(sampleCount(0)), length: asset.length },
    timelineStart: expectSuccess(sampleCount(0)),
    timelineLength: asset.length,
    gain: 1,
    fadeInLength: expectSuccess(sampleCount(0)),
    fadeOutLength: expectSuccess(sampleCount(0)),
    muted: false,
  };
}
