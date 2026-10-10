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

import type { CodecId, CodecImplementation, ContainerId } from '@audiogubbins/codecs';
import type { ChannelLayout, SampleCount, SampleRate } from '@audiogubbins/domain';

import type { ContentId } from './content-identity.js';
import type { ExternalSourceIdentity } from './project-state.js';

/** The implementation that decoded a stream, and its version. */
export interface DecoderIdentity {
  readonly implementation: CodecImplementation;

  /** The decoder's own name, such as a crate's or a browser's. */
  readonly name: string;
  readonly version: string;
}

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

/** The compressed file an asset's media is a decoded rendition of (see the module comment). */
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
