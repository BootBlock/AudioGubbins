/**
 * The framing of an encoder's output into a file (ADR-0091).
 *
 * The encoders AudioGubbins uses answer encoded units, not files: FLAC frames,
 * Opus packets, AAC access units and MP3 frames. A framer wraps those into the
 * file the format defines, in the shape of the streaming write contract: the
 * body as the units arrive, then a head completed at the end, when the sizes,
 * counts and checksums it states are known, and a tail. The codec worker
 * composes an encoder and a framer into an `AudioFileWriter`.
 *
 * A framer reads each unit's duration from the unit itself, never from the
 * caller, so a stream whose stated length disagrees with its units cannot be
 * written. A framer is used once, from one thread; its work for a unit is
 * bounded by the unit, so it is synchronous.
 */

import type { DomainResult } from '@audiogubbins/domain';

import type { FinishedAudioFile } from './audio-file-writer.js';

/** A framer, and what its format needs to know at the stream's end. */
export interface EncodedStreamWriter<TEnd> {
  /** Adds one encoded unit, answering the body bytes it completes, possibly none. */
  add(unit: Uint8Array): DomainResult<readonly Uint8Array[]>;

  /** Ends the stream, answering the last body bytes as well as the head and tail. */
  finish(end: TEnd): DomainResult<FinishedEncodedStream>;
}

/** A finished stream: the file's head and tail, and the body bytes the end completed. */
export interface FinishedEncodedStream extends FinishedAudioFile {
  /** Body bytes held back until the end, which follow every body byte answered before. */
  readonly body: readonly Uint8Array[];
}

/**
 * The end of a lossy stream: how many frames the encoder was given, at the
 * rate the format counts in, so the priming before them and the padding after
 * them are trimmed by every player that reads the file's statement of them.
 */
export interface EncodedStreamLength {
  readonly inputFrames: number;
}
