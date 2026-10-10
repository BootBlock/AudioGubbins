/**
 * A file's metadata as one typed value, read from and written to every format
 * (ADR-0093).
 *
 * Each format's reader fills the parts its file holds, and each writer writes
 * the parts its format can hold and names the rest as dropped, so nothing is
 * lost without the person being told. Every value read from a file is
 * untrusted text or bytes (REQ-EXEC-136): readers bound what they keep, and
 * nothing here is interpreted as a path or markup.
 *
 * Positions are frames of the file the map was read from or is written to.
 */

import type { SampleCount } from '@audiogubbins/domain';

/** The text fields with a meaning every format can map. */
export type MetadataTextKey =
  | 'title'
  | 'artist'
  | 'album'
  | 'albumArtist'
  | 'trackNumber'
  | 'trackTotal'
  | 'discNumber'
  | 'discTotal'
  | 'date'
  | 'genre'
  | 'comment'
  | 'copyright'
  | 'encoder'
  | 'isrc';

/** A field a format names that has no typed key, kept by the format's own key. */
export interface ForeignMetadataField {
  /** The format the key belongs to, such as `riff-info`, `id3v2`, `vorbis-comment`, `ilst`. */
  readonly scheme: string;
  readonly key: string;
  readonly value: string;
}

/** The Broadcast Wave description (EBU Tech 3285). */
export interface BroadcastDescription {
  readonly description: string;
  readonly originator: string;
  readonly originatorReference: string;

  /** `yyyy-mm-dd`, as the chunk holds it. */
  readonly originationDate: string;

  /** `hh:mm:ss`, as the chunk holds it. */
  readonly originationTime: string;

  /** The first frame's position since midnight, in frames. */
  readonly timeReference: SampleCount;
  readonly codingHistory: string;
}

/** A named point. */
export interface CuePoint {
  readonly position: SampleCount;
  readonly name: string;
}

/** How a loop plays. */
export type LoopDirection = 'forward' | 'alternating' | 'backward';

/** A loop of the file's frames. */
export interface MetadataLoop {
  readonly start: SampleCount;
  readonly length: SampleCount;

  /** How many times it plays, or `'endless'`. */
  readonly playCount: number | 'endless';
  readonly direction: LoopDirection;
  readonly name?: string;
}

/** The sampler's tuning a file states. */
export interface SamplerTuning {
  /** The MIDI note at which the sound plays unchanged, 0 to 127. */
  readonly unityNote: number;

  /** The fine tuning in cents, -50 to 50. */
  readonly fineTuneCents: number;
}

/** An embedded picture. */
export interface CoverArt {
  readonly mediaType: string;
  readonly description: string;
  readonly bytes: Uint8Array;
}

/** A file's metadata. Every part is optional; an empty map is `{}`. */
export interface MetadataMap {
  readonly text?: Readonly<Partial<Record<MetadataTextKey, string>>>;
  readonly foreign?: readonly ForeignMetadataField[];
  readonly broadcast?: BroadcastDescription;
  readonly cues?: readonly CuePoint[];
  readonly loops?: readonly MetadataLoop[];
  readonly tuning?: SamplerTuning;
  readonly coverArt?: CoverArt;
}

/** The parts of a map, as a writer names those its format cannot hold. */
export type MetadataPart =
  | { readonly kind: 'text'; readonly key: MetadataTextKey }
  | { readonly kind: 'foreign'; readonly scheme: string; readonly key: string }
  | { readonly kind: 'broadcast' }
  | { readonly kind: 'cues' }
  | { readonly kind: 'loops' }
  | { readonly kind: 'tuning' }
  | { readonly kind: 'coverArt' };
