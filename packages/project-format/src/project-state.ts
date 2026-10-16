/**
 * The authoritative project aggregate: the domain project with where each of
 * its assets' bytes come from and how each was imported.
 *
 * ADR-0015 leaves the domain `Project` without storage or schema, and ADR-0020
 * puts the persisted project here. A {@link ProjectState} is what a command
 * produces, what the history records and what a document holds. It is an
 * in-memory value, never a JSON shape: `project-json.ts` converts it field by
 * field (REQ-EXEC-136.12).
 *
 * Invariants, which the document reader enforces: every asset of the project
 * has exactly one source and every source belongs to an asset, each asset's
 * `storageKey` is {@link storageKeyOf} its source, and the audio shape its
 * provenance keeps, where it keeps one, agrees with the asset. Serves
 * REQ-STOR-026, REQ-STOR-053, REQ-STOR-099, REQ-STOR-104 and REQ-STOR-166.
 */

import type { CodecId, ContainerId, DecoderIdentity } from '@audiogubbins/codecs';
import type {
  AssetId,
  ChannelLayout,
  Project,
  ProjectId,
  SampleCount,
  SampleRate,
} from '@audiogubbins/domain';

import { holdsNoGameAudio, type GameAudioState } from '@audiogubbins/game-audio';
import type { ExportSettings } from '@audiogubbins/import-export';

import type { ContentId } from './content-identity.js';
import type { KeptMetadata } from './kept-metadata.js';
import type { RecordedProvenance } from './recorded-provenance.js';

/** A project and the source of each of its assets. */
export interface ProjectState {
  readonly project: Project;
  readonly sources: ReadonlyMap<AssetId, AssetSource>;

  /**
   * The settings the project was last exported with, which the Export dialog
   * opens with, or absent where it has never been exported (ADR-0092).
   */
  readonly exportSettings?: ExportSettings;

  /**
   * The project's asset groups and who belongs to them (ADR-0101, ADR-0106),
   * absent where it has none: one form for a project without them, which
   * {@link withGameAudio} keeps and the document's reader holds it to.
   */
  readonly gameAudio?: GameAudioState;
}

/** Where one asset's bytes come from, and how it came into the project. */
export interface AssetSource {
  readonly media: MediaSource;

  /**
   * How the asset was imported, or `undefined` where provenance was stripped to
   * nothing (see `provenance-stripping.ts`).
   */
  readonly provenance?: AssetProvenance;
}

/** Where an asset's bytes are kept. */
export type MediaSource = ManagedMedia | ExternalMedia;

/**
 * Bytes copied into the application's content-addressed store (REQ-STOR-099),
 * found by their content and shared by every project that holds them.
 */
export interface ManagedMedia {
  readonly kind: 'managed';
  readonly contentId: ContentId;
  readonly byteLength: number;

  /** The media type, such as `audio/wav`, without parameters. */
  readonly mediaType: string;
}

/**
 * Bytes left where the user keeps them and read through a kept permission.
 *
 * The file can change behind the project's back, so the identity it had is
 * recorded (REQ-STOR-104) with the policy for a change (REQ-STOR-053).
 */
export interface ExternalMedia {
  readonly kind: 'external';
  readonly identity: ExternalSourceIdentity;
  readonly policy: SourceChangePolicy;

  /**
   * A managed copy of the last content known, which is what lets a change be
   * refused and the prior version kept. {@link SourceChangePolicy.Freeze} needs
   * one.
   */
  readonly retainedCopy?: ContentId;
}

/**
 * What an external file was known by when it was last seen.
 *
 * Never a path or a file name alone (REQ-STOR-104): enough signals to tell the
 * same unchanged file, a modified one, a moved copy with the same content, and
 * another file in its place. None of it is an absolute path (REQ-PRIV-165).
 */
export interface ExternalSourceIdentity {
  /**
   * An opaque token under which the platform's handle to the file is kept.
   * Never a path; it names an entry in the application's own handle store.
   */
  readonly handleKey?: string;

  /** The file's name, for display only and never for identity. */
  readonly fileName?: string;

  /**
   * Where the file lies inside a directory the user granted, with forward
   * slashes and no `.` or `..` segment.
   */
  readonly relativePath?: string;

  readonly byteLength: number;

  /** When the file was last modified, in milliseconds since the epoch. */
  readonly lastModified: number;

  /** The media type, such as `audio/wav`, without parameters. */
  readonly mediaType: string;

  /**
   * Up to the first 16 bytes of the file in lower-case hexadecimal: the
   * container's magic, which says what kind of file stands there now.
   */
  readonly signature: string;

  /** A quick digest of sampled ranges, 64 hexadecimal digits, from the media store. */
  readonly fastFingerprint: string;

  /** The full content identity, once progressive hashing has finished. */
  readonly contentId?: ContentId;
}

/**
 * What happens when an external source is found to have changed.
 *
 * REQ-STOR-053 forbids silent adoption as the default, so the default is to ask
 * ({@link DEFAULT_SOURCE_CHANGE_POLICY}).
 */
export const SourceChangePolicy = {
  /** Ask the user what to do. */
  Prompt: 'prompt',

  /** Take the new version without asking. */
  Adopt: 'adopt',

  /** Keep playing the retained copy of the version the project was made with. */
  Freeze: 'freeze',
} as const;

/** What happens when an external source is found to have changed. */
export type SourceChangePolicy = (typeof SourceChangePolicy)[keyof typeof SourceChangePolicy];

/** The policy a newly linked source takes. */
export const DEFAULT_SOURCE_CHANGE_POLICY: SourceChangePolicy = SourceChangePolicy.Prompt;

/**
 * How an asset came into a project (REQ-STOR-166).
 *
 * The asset's sample rate, channel layout and length are on the domain asset,
 * and are not repeated here.
 */
export interface AssetProvenance {
  /** The name of the file imported, where provenance keeps it. */
  readonly originalFileName?: string;

  /** When it was imported, in milliseconds since the epoch. */
  readonly importedAt: number;

  /** The content identity of the file imported, where it was computed. */
  readonly sourceContentId?: ContentId;

  /** The fast fingerprint of the file imported, where it was computed. */
  readonly sourceFingerprint?: string;

  readonly byteLength: number;
  readonly mediaType: string;

  /** The project the asset was first imported into. */
  readonly originProjectId: ProjectId;

  /**
   * The audio shape of the file imported, where its audio is read where it
   * lies: what its header states and how much of it was there (REQ-AUDIO-220).
   */
  readonly audio?: SourceAudioShape;

  /**
   * The compressed file the asset's media was decoded from, where its media
   * is a decoded rendition of one (ADR-0090): what the file is, the decoder
   * that made the rendition, and how the file itself is kept.
   */
  readonly rendition?: DecodedRendition;

  /** The file's metadata, as the file states it, in the file's frames (ADR-0093). */
  readonly metadata?: KeptMetadata;

  /** How it was recorded, where it is a recording (ADR-0071). */
  readonly recording?: RecordedProvenance;
}

/**
 * The audio shape of an imported file, as its reader found it (REQ-STOR-166,
 * REQ-AUDIO-220, ADR-0052).
 *
 * The asset carries the rate and length it plays at; these are kept as the
 * file stated them, so how a sound was produced can be traced back to the
 * file and a file that was cut short says so. The document's reader holds the
 * two to agree: the same rate, and the asset as long as the frames read.
 */
export interface SourceAudioShape {
  readonly container: SourceContainer;
  readonly sampleRate: SampleRate;
  readonly encoding: SourceEncoding;

  /** The layout the file states, or absent where it states none. */
  readonly statedLayout?: ChannelLayout;

  /** The whole frames read. */
  readonly frames: SampleCount;

  /** The frames the header declared, more than `frames` where the file was cut short. */
  readonly declaredFrames: SampleCount;
}

/**
 * How an imported file stores its samples where they are read in place
 * (ADR-0052, ADR-0090): uncompressed PCM, with its bits and byte order as
 * the file states them, or one of the codes WAV and AIFF-C carry that decode
 * in independent blocks, each kind named as the codec registry names it.
 */
export type SourceEncoding =
  | {
      readonly kind: 'integer' | 'float';

      /** Bits per sample, as the file states them. */
      readonly bits: number;
      readonly byteOrder: 'little' | 'big';
    }
  /** ITU-T G.711, a companded byte a sample. */
  | { readonly kind: 'g711-alaw' | 'g711-ulaw' }
  /** IMA or Microsoft ADPCM, four bits a sample in blocks of `framesPerBlock` frames. */
  | { readonly kind: 'ima-adpcm' | 'ms-adpcm'; readonly framesPerBlock: number };

/**
 * How the compressed file is kept: copied into the media store under its
 * content identity, or linked where it lies, known by its identity, with a
 * protected copy where the person keeps one.
 */
export type KeptCompressedSource =
  | { readonly kind: 'copied'; readonly contentId: ContentId }
  | {
      readonly kind: 'linked';
      readonly identity: ExternalSourceIdentity;
      readonly retainedCopy?: ContentId;
    };

/**
 * The compressed file an asset's media was decoded from (ADR-0090,
 * REQ-STOR-166, REQ-ARCH-049).
 *
 * A file in a format that cannot be read at an arbitrary frame is decoded
 * once, at the rate its stream states, into a rendition: a 32-bit float WAV
 * file in the media store, which is the asset's media and which every audio
 * thread reads. The project's sound is the rendition's, so a decoder updated
 * later never changes it; what produced it is recorded here: the file's
 * container and codec, its stream's rate, layout and length, its bit rate
 * where it states one, the decoder and its version, and where the file itself
 * is kept, copied into the store or linked where it lies, as the person chose
 * (REQ-STOR-025).
 *
 * The rendition is the decoded stream from its first frame after the priming
 * the file states, trimmed; `leadingFrames` counts the file's frames before
 * it, which the file's own positions, its loops and cues, count from, so a
 * position of the file is the rendition's frame `position - leadingFrames`.
 */
export interface DecodedRendition {
  readonly container: ContainerId;
  readonly codec: CodecId;

  /** The stream's rate, which the rendition and the asset keep. */
  readonly sampleRate: SampleRate;

  /** The stream's channels, in the order the rendition holds them. */
  readonly layout: ChannelLayout;

  /** The frames decoded, which the rendition holds. */
  readonly frames: SampleCount;

  /** The frames the stream states it holds, where it states them. */
  readonly statedFrames?: SampleCount;

  /** The file's average bit rate in bits a second, where it states one. */
  readonly bitRate?: number;

  /** The file's frames before the rendition's first: the priming trimmed. */
  readonly leadingFrames: SampleCount;
  readonly decoder: DecoderIdentity;
  readonly kept: KeptCompressedSource;
}

/** The containers an imported file's audio is read from (ADR-0052). */
export const SOURCE_CONTAINERS = ['wav', 'rf64', 'bw64', 'aiff', 'aifc'] as const;

/** A container an imported file's audio is read from. */
export type SourceContainer = (typeof SOURCE_CONTAINERS)[number];

/**
 * The storage key a domain asset carries for its source: `content:` and the
 * content identity for managed media, so assets with the same bytes share one,
 * and `external:` and the asset for external media, whose bytes have no key the
 * store could share.
 */
export function storageKeyOf(assetId: AssetId, media: MediaSource): string {
  return media.kind === 'managed' ? `content:${media.contentId}` : `external:${assetId}`;
}

/**
 * `state` holding `game` as its game-audio state, or none where `game` holds
 * nothing: the one way a state's game-audio member is set, so a project whose
 * last group and scenario go is the project it was before its first, in memory
 * and in its document alike.
 */
export function withGameAudio(state: ProjectState, game: GameAudioState): ProjectState {
  const { gameAudio: _held, ...rest } = state;
  return holdsNoGameAudio(game) ? rest : { ...rest, gameAudio: game };
}

/**
 * The state of a project that has no assets yet.
 *
 * Throws if the project has any: an asset without a source would break the
 * aggregate's first invariant, and only a command that adds both may add one.
 */
export function emptyProjectState(project: Project): ProjectState {
  if (project.assets.size > 0) {
    throw new Error('An empty project state is made from a project with no assets.');
  }
  return { project, sources: new Map() };
}
