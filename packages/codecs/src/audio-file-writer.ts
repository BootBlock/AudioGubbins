/**
 * The streaming write contract every encoder serves (ADR-0090, ADR-0092).
 *
 * An export is rendered in blocks and staged as it goes, so a writer answers
 * the body of its file block by block and is never handed the whole sound. A
 * container whose opening depends on the whole stream (FLAC's stream
 * information, an MP4 movie box written first, MP3's information frame, a WAV
 * header whose sizes are known only at the end) completes its head when the
 * stream ends; the file is the head, then the body in order, then the tail.
 */

import type { CancellationSignal, DomainResult } from '@audiogubbins/domain';

import type { MetadataPart } from './metadata-map.js';

/**
 * One channel's samples of a block. A rendered block is 32-bit float; a block
 * quantised to a 32-bit integer depth is 64-bit, since a 32-bit float cannot
 * hold every `k / 2^31` and the integer written would not be the one the
 * dither chose.
 */
export type SamplePlane = Float32Array | Float64Array;

/** The end of a written file. */
export interface FinishedAudioFile {
  /** The bytes before the body. */
  readonly head: Uint8Array;

  /** The bytes after the body, such as chunks a RIFF file keeps after its data. */
  readonly tail: Uint8Array;

  /** The parts of the metadata the format could not hold, so none is dropped unsaid. */
  readonly dropped: readonly MetadataPart[];
}

/**
 * One file being written. `write` takes planar blocks of the writer's channel
 * count and answers the body bytes they complete, possibly none; `finish`
 * answers the head and the tail once every block is written. A writer is used
 * once, from one thread, and a failed call ends it.
 */
export interface AudioFileWriter {
  write(
    channels: readonly SamplePlane[],
    frames: number,
    signal?: CancellationSignal,
  ): Promise<DomainResult<readonly Uint8Array[]>>;
  finish(signal?: CancellationSignal): Promise<DomainResult<FinishedAudioFile>>;
}
