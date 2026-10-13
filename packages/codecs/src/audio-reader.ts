/**
 * Opening a file and reading its frames on demand, at the rate it was recorded
 * at (ADR-0050, ADR-0052).
 *
 * Opening parses the header in bounded reads and refuses, before anything is
 * stored, a file this package does not read in place or one whose header breaks
 * its format's rules. A read then fetches only the bytes of the blocks that
 * hold the frames asked for, a block being one frame of uncompressed PCM or
 * G.711 or one ADPCM block, in pieces of at most `MAXIMUM_READ_BYTES`, so
 * neither a long read nor a long file is ever held whole, and decodes them by
 * the rule of their encoding (`block-coding.ts`).
 */

import {
  fail,
  mapResult,
  succeed,
  throwIfCancelled,
  type CancellationSignal,
  type DomainResult,
  type SampleCount,
} from '@audiogubbins/domain';

import type { AudioBytes } from './audio-bytes.js';
import type { BlockCoding } from './block-coding.js';
import { readExactly } from './byte-reading.js';
import { readInvalid, readPastEnd, unsupportedFormat } from './codec-failures.js';
import type { AudioFormatDescriptor } from './format-descriptor.js';
import { recogniseStage } from './recognition.js';
import { blockCoding } from './sample-coding.js';

/** The most bytes one read asks the source for. */
const MAXIMUM_READ_BYTES = 1 << 20;

/** An open audio file. */
export interface AudioReader {
  readonly format: AudioFormatDescriptor;

  /**
   * Reads up to `frames` frames from `start` into `into`, one array per channel
   * in the file's channel order, each at least `frames` long, and answers how
   * many frames it wrote: fewer than `frames` only where the file ends first.
   */
  read(
    start: SampleCount,
    frames: number,
    into: readonly Float32Array[],
    signal?: CancellationSignal,
  ): Promise<DomainResult<number>>;
}

/** Why a read cannot be asked for, or `undefined` where it can. */
function requestProblem(
  format: AudioFormatDescriptor,
  start: SampleCount,
  frames: number,
  into: readonly Float32Array[],
): DomainResult<never> | undefined {
  if (!Number.isSafeInteger(frames) || frames < 0) {
    return fail(readInvalid('A read asks for a whole number of frames, none or more.'));
  }
  if (into.length !== format.channelCount) {
    return fail(readInvalid('A read needs one output array for each channel of the file.'));
  }
  if (into.some((channel) => channel.length < frames)) {
    return fail(readInvalid('Each output array of a read must hold the frames asked for.'));
  }
  return start > format.frames ? fail(readPastEnd(start, format.frames)) : undefined;
}

/** A reader of the frames a descriptor locates in `bytes`, decoded by its block coding. */
function blockReader(
  bytes: AudioBytes,
  format: AudioFormatDescriptor,
  coding: BlockCoding,
): AudioReader {
  const { blockBytes, framesPerBlock } = coding;
  const blocksPerRead = Math.max(1, Math.floor(MAXIMUM_READ_BYTES / blockBytes));
  return {
    format,
    read: async (start, frames, into, signal) => {
      throwIfCancelled(signal);
      const problem = requestProblem(format, start, frames, into);
      if (problem !== undefined) return problem;
      const count = Math.min(frames, format.frames - start);
      let block = Math.floor(start / framesPerBlock);
      // Only the first piece starts inside a block; each later one starts at a block's first frame.
      let skip = start - block * framesPerBlock;
      for (let done = 0; done < count;) {
        const piece = Math.min(count - done, blocksPerRead * framesPerBlock - skip);
        const offset = format.dataOffset + block * blockBytes;
        const bytesRead = await readExactly(bytes, offset, coding.bytesFor(skip + piece), signal);
        if (!bytesRead.ok) return bytesRead;
        const decoded = coding.decode(bytesRead.value, skip, piece, into, done);
        if (!decoded.ok) return decoded;
        done += piece;
        block += blocksPerRead;
        skip = 0;
      }
      return succeed(count);
    },
  };
}

/**
 * Opens a file: recognises its format from its contents, parses its header and
 * answers a reader of its frames, or the failure that refuses it.
 */
export async function openAudio(
  bytes: AudioBytes,
  signal?: CancellationSignal,
): Promise<DomainResult<AudioReader>> {
  const stage = await recogniseStage(bytes, signal);
  if (!stage.ok) return stage;
  if (!stage.value.readable) return fail(unsupportedFormat(stage.value.format));
  const described = await stage.value.describe(signal);
  throwIfCancelled(signal);
  if (!described.ok) return described;
  const format = described.value;
  return mapResult(blockCoding(format.encoding, format.channelCount, format.blockAlign), (coding) =>
    blockReader(bytes, format, coding),
  );
}
