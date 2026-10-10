/**
 * Random values from a seed for the property tests: names, content
 * identifiers, channel layouts, and assets with their sources.
 *
 * Deterministic: one seed always gives one sequence, so a failing case is found
 * again by its seed. Names mix scripts, escapes, padding and a lone surrogate,
 * because a document may hold any of them and every reader and command must
 * give each back exactly. Sources are managed and external with every optional
 * member sometimes present, a recorded asset's sometimes saying how it was
 * recorded, and each asset is keyed as its source gives.
 */

import {
  AmbisonicNormalisation,
  AmbisonicOrdering,
  AssetOrigin,
  StandardLayouts,
  ambisonicLayout,
  derivedSampleCount,
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
import type { CommonExportSettings, ExportSettings } from '@audiogubbins/import-export';

import type { AssetRecord } from '../asset-record-json.js';
import type { DecodedRendition } from '../project-state.js';
import type { KeptMetadata } from '../kept-metadata.js';
import {
  CaptureProfileKind,
  RecordingEnding,
  type CaptureSettings,
  type RecordedProvenance,
  type RecordingStart,
} from '../recorded-provenance.js';
import { contentIdFrom, type ContentId } from '../content-identity.js';
import { writtenName } from '../given-names.js';
import {
  SOURCE_CONTAINERS,
  SourceChangePolicy,
  storageKeyOf,
  type AssetProvenance,
  type SourceAudioShape,
  type SourceEncoding,
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
  const provenance = maybe(random, () => randomProvenance(random, ids, projectId, asset, media));
  return { asset, source: { media, ...(provenance === undefined ? {} : { provenance }) } };
}

function randomProvenance(
  random: Random,
  ids: IdGenerator,
  projectId: ProjectId,
  asset: Asset,
  media: MediaSource,
): AssetProvenance {
  const originalFileName = maybe(random, () => `${randomHex(random, 5)} ß.flac`);
  const sourceContentId = maybe(random, () => randomContentId(random));
  const sourceFingerprint = maybe(random, () => randomHex(random, 64));
  const audio = maybe(random, () => randomAudioShape(random, asset));
  const recording =
    asset.origin === AssetOrigin.Recorded
      ? maybe(random, () => randomRecording(random, asset))
      : undefined;
  // A rendition is the asset's managed media, and the only record of how its audio was read.
  const rendition =
    media.kind === 'managed' && audio === undefined && recording === undefined
      ? maybe(random, () => randomRendition(random, asset))
      : undefined;
  const metadata = maybe(random, () => randomMetadata(random));
  return {
    ...(originalFileName === undefined ? {} : { originalFileName }),
    importedAt: random.below(2 ** 42),
    ...(sourceContentId === undefined ? {} : { sourceContentId }),
    ...(sourceFingerprint === undefined ? {} : { sourceFingerprint }),
    byteLength: random.below(2 ** 40),
    mediaType: random.pick(MEDIA_TYPES),
    originProjectId: random.chance(0.7) ? projectId : ids.next<'ProjectId'>(),
    ...(audio === undefined ? {} : { audio }),
    ...(rendition === undefined ? {} : { rendition }),
    ...(metadata === undefined ? {} : { metadata }),
    ...(recording === undefined ? {} : { recording }),
  };
}

/** The compressed file an asset's media was decoded from, agreeing with the asset. */
function randomRendition(random: Random, asset: Asset): DecodedRendition {
  const statedFrames = maybe(random, () => randomCount(random, 20_000_000));
  const bitRate = maybe(random, () => 1 + random.below(2 ** 20));
  return {
    container: random.pick(['flac', 'mp3', 'ogg', 'mp4', 'adts', 'webm', 'matroska'] as const),
    codec: random.pick(['flac', 'alac', 'mp3', 'vorbis', 'opus', 'aac-lc', 'he-aac'] as const),
    sampleRate: asset.sampleRate,
    layout: asset.channelLayout,
    frames: asset.length,
    ...(statedFrames === undefined ? {} : { statedFrames }),
    ...(bitRate === undefined ? {} : { bitRate }),
    leadingFrames: randomCount(random, 5_000),
    decoder: {
      implementation: random.pick(['codec-module', 'browser', 'prebuilt-module'] as const),
      name: randomHeldName(random).slice(0, 200),
      version: `${String(random.below(10))}.${String(random.below(100))}.${String(random.below(100))}`,
    },
    kept: random.chance(0.5)
      ? { kind: 'copied', contentId: randomContentId(random) }
      : {
          kind: 'linked',
          identity: randomIdentity(random),
          ...(random.chance(0.5) ? { retainedCopy: randomContentId(random) } : {}),
        },
  };
}

/** A file's metadata, each part sometimes present, its text in any script. */
function randomMetadata(random: Random): KeptMetadata {
  const title = maybe(random, () => randomHeldName(random));
  const comment = maybe(
    random,
    () => `${randomHeldName(random)}
${randomHeldName(random)}`,
  );
  const parts: KeptMetadata = {
    ...(title === undefined && comment === undefined
      ? {}
      : {
          text: {
            ...(title === undefined ? {} : { title }),
            ...(comment === undefined ? {} : { comment }),
          },
        }),
    ...(random.chance(0.5)
      ? { foreign: [{ scheme: 'vorbis-comment', key: 'MOOD', value: randomHeldName(random) }] }
      : {}),
    ...(random.chance(0.3)
      ? {
          broadcast: {
            description: randomHeldName(random),
            originator: 'AudioGubbins',
            originatorReference: randomHex(random, 8),
            originationDate: '2026-10-10',
            originationTime: '12:00:00',
            timeReference: randomCount(random, 2 ** 40),
            codingHistory: 'A=PCM,F=48000,W=24,M=stereo',
          },
        }
      : {}),
    ...(random.chance(0.5)
      ? {
          cues: Array.from({ length: random.below(4) }, () => ({
            position: randomCount(random, 1_000_000),
            name: randomHeldName(random),
          })),
        }
      : {}),
    ...(random.chance(0.5)
      ? {
          loops: Array.from({ length: random.below(3) }, () => ({
            start: randomCount(random, 1_000_000),
            length: randomCount(random, 1_000_000),
            playCount: random.chance(0.5) ? ('endless' as const) : random.below(100),
            direction: random.pick(['forward', 'alternating', 'backward'] as const),
            ...(random.chance(0.5) ? { name: randomHeldName(random) } : {}),
          })),
        }
      : {}),
    ...(random.chance(0.3)
      ? { tuning: { unityNote: random.below(128), fineTuneCents: random.below(101) - 50 } }
      : {}),
    ...(random.chance(0.3)
      ? {
          coverArt: {
            mediaType: 'image/png',
            description: randomHeldName(random),
            byteLength: random.below(1_048_577),
          },
        }
      : {}),
  };
  return parts;
}

/**
 * The audio shape of the file an asset was imported from, agreeing with the
 * asset as the reader requires, and sometimes cut short of what it declared.
 */
function randomAudioShape(random: Random, asset: Asset): SourceAudioShape {
  const statedLayout = maybe(random, () => asset.channelLayout);
  const float = random.chance(0.3);
  const byteOrder = random.chance(0.5) ? 'little' : 'big';
  const coded = random.chance(0.3);
  const encoding: SourceEncoding = coded
    ? random.pick([
        { kind: 'g711-alaw' },
        { kind: 'g711-ulaw' },
        { kind: 'ima-adpcm', framesPerBlock: 1 + random.below(2_048) },
        { kind: 'ms-adpcm', framesPerBlock: 2 + random.below(2_048) },
      ] as const)
    : float
      ? { kind: 'float', bits: random.pick([32, 64]), byteOrder }
      : { kind: 'integer', bits: random.pick([8, 12, 16, 20, 24, 32]), byteOrder };
  return {
    container: random.pick(SOURCE_CONTAINERS),
    sampleRate: asset.sampleRate,
    encoding,
    ...(statedLayout === undefined ? {} : { statedLayout }),
    frames: asset.length,
    declaredFrames: random.chance(0.8)
      ? asset.length
      : expectSuccess(sampleCount(asset.length + 1 + random.below(10_000))),
  };
}

/** Labels a browser may give a device, any script among them. */
const LABELS = ['Built-in Microphone', 'USB Audio Interface (2-ch)', 'Mikrofon „Ü“', '麦克风'];

/** Random capture settings, each member sometimes present. */
function randomSettings(random: Random): CaptureSettings {
  const some = <TValue>(make: () => TValue): TValue | undefined =>
    random.chance(0.5) ? make() : undefined;
  const echoCancellation = some(() => random.chance(0.5));
  const noiseSuppression = some(() => random.chance(0.5));
  const autoGainControl = some(() => random.chance(0.5));
  const voiceIsolation = some(() => random.chance(0.5));
  const channelCount = some(() => 1 + random.below(8));
  const sampleRate = some(() => random.pick([44_100, 48_000, 96_000]));
  const sampleSize = some(() => random.pick([16, 24, 32]));
  const latency = some(() => random.pick([0, 0.01, 0.1 + 0.2, 0.25]));
  return {
    ...(echoCancellation === undefined ? {} : { echoCancellation }),
    ...(noiseSuppression === undefined ? {} : { noiseSuppression }),
    ...(autoGainControl === undefined ? {} : { autoGainControl }),
    ...(voiceIsolation === undefined ? {} : { voiceIsolation }),
    ...(channelCount === undefined ? {} : { channelCount }),
    ...(sampleRate === undefined ? {} : { sampleRate }),
    ...(sampleSize === undefined ? {} : { sampleSize }),
    ...(latency === undefined ? {} : { latency }),
  };
}

/** What is known of a recording of `asset`'s rate and layout as it starts. */
export function randomRecordingStart(
  random: Random,
  asset: Pick<Asset, 'sampleRate' | 'channelLayout'>,
): RecordingStart {
  const label = random.chance(0.6) ? random.pick(LABELS) : undefined;
  const group = random.chance(0.5) ? `group-${String(random.below(1_000))}` : undefined;
  const channelCount = random.chance(0.5) ? 1 + random.below(8) : undefined;
  return {
    recordedAt: random.below(2 ** 42),
    device: {
      ...(label === undefined ? {} : { label }),
      ...(group === undefined ? {} : { group }),
      ...(channelCount === undefined ? {} : { channelCount }),
    },
    profile: {
      kind: random.pick(Object.values(CaptureProfileKind)),
      name: random.pick(['Raw/Studio', 'Voice', 'My booth']),
    },
    requested: randomSettings(random),
    granted: randomSettings(random),
    sampleRate: asset.sampleRate,
    layout: asset.channelLayout,
  };
}

/**
 * How `asset` was recorded: at its rate and in its layout, as long as it is,
 * now and then with frames lost, as many as it is long at most.
 */
export function randomRecording(random: Random, asset: Asset): RecordedProvenance {
  const count = asset.length > 0 && random.chance(0.3) ? 1 + random.below(asset.length) : 0;
  const gaps =
    count === 0
      ? undefined
      : { count, frames: derivedSampleCount(count + random.below(asset.length - count + 1)) };
  return {
    ...randomRecordingStart(random, asset),
    length: asset.length,
    ending: random.pick(Object.values(RecordingEnding)),
    ...(gaps === undefined ? {} : { gaps }),
  };
}

/** Random export settings of any format, every shared choice among them. */
export function randomExportSettings(random: Random): ExportSettings {
  const common: CommonExportSettings = {
    sampleRate: expectSuccess(sampleRate(random.pick(RATES))),
    channels: random.pick([
      { kind: 'keep' },
      { kind: 'fold', to: StandardLayouts.stereo },
      { kind: 'matrix', matrix: 'mid-side-encode' },
      { kind: 'map', channels: [0, 0], to: StandardLayouts.stereo },
    ] as const),
    dither: random.chance(0.5)
      ? { kind: 'none' }
      : {
          kind: random.pick(['rectangular', 'triangular'] as const),
          amplitude: 0.5 + random.below(4),
          shaping: random.pick(['none', 'first-order', 'lipshitz-e-weighted'] as const),
          seed: random.below(2 ** 32),
        },
    range: random.pick([{ kind: 'project' }, { kind: 'every-region' }] as const),
    metadata: {
      policy: random.pick(['full', 'minimal', 'none'] as const),
      edits: random.chance(0.5)
        ? []
        : [{ kind: 'set', key: 'title', value: randomHeldName(random) }],
    },
    fileName: '{project} {index}',
  };
  return random.pick<ExportSettings>([
    { ...common, format: 'wav', encoding: { kind: 'integer', bits: 24 } },
    { ...common, format: 'aifc', encoding: { kind: 'float', bits: 32 } },
    { ...common, format: 'flac', encoding: { bits: 16, compressionLevel: random.below(9) } },
    { ...common, format: 'mp3', encoding: { mode: 'average', bitRate: 192 } },
    { ...common, format: 'ogg-vorbis', encoding: { mode: 'quality', quality: random.below(11) } },
    {
      ...common,
      format: 'opus',
      encoding: { bitRate: 96, application: 'voip', frameDuration: 20, complexity: 10 },
    },
    { ...common, format: 'aac', encoding: { bitRate: 128 } },
  ]);
}
