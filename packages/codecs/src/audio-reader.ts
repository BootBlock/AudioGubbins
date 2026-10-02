/**
 * Opening a file and reading its frames on demand, at the rate it was recorded
 * at (ADR-0050, ADR-0052).
 *
 * Opening parses the header in bounded reads and refuses, before anything is
 * stored, a file this package does not read or one whose header breaks its
 * format's rules. A read then fetches only the bytes of the frames asked for,
 * in pieces of at most `MAXIMUM_READ_BYTES`, so neither a long read nor a long
 * file is ever held whole, and converts each by the rule in
 * `sample-conversion.ts`.
 */

import {
  fail,
  mapResult,
  succeed,
  type DomainResult,
  type SampleCount,
} from '@audiogubbins/domain';

import { throwIfCancelled, type AudioBytes, type ReadSignal } from './audio-bytes.js';
import { readExactly } from './byte-reading.js';
import { readInvalid, readPastEnd, unsupportedFormat } from './codec-failures.js';
import type { AudioFormatDescriptor } from './format-descriptor.js';
import { recogniseStage } from './recognition.js';
import { decodeFrames } from './sample-conversion.js';

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
    signal?: ReadSignal,
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

/** A reader of the frames a descriptor locates in `bytes`. */
function pcmReader(bytes: AudioBytes, format: AudioFormatDescriptor): AudioReader {
  const framesPerRead = Math.max(1, Math.floor(MAXIMUM_READ_BYTES / format.blockAlign));
  return {
    format,
    read: async (start, frames, into, signal) => {
      throwIfCancelled(signal);
      const problem = requestProblem(format, start, frames, into);
      if (problem !== undefined) return problem;
      const count = Math.min(frames, format.frames - start);
      for (let done = 0; done < count; done += framesPerRead) {
        const piece = Math.min(framesPerRead, count - done);
        const offset = format.dataOffset + (start + done) * format.blockAlign;
        const bytesRead = await readExactly(bytes, offset, piece * format.blockAlign, signal);
        if (!bytesRead.ok) return bytesRead;
        decodeFrames(format.encoding, bytesRead.value, piece, into, done);
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
  signal?: ReadSignal,
): Promise<DomainResult<AudioReader>> {
  const stage = await recogniseStage(bytes, signal);
  if (!stage.ok) return stage;
  if (!stage.value.readable) return fail(unsupportedFormat(stage.value.format));
  const described = await stage.value.describe(signal);
  throwIfCancelled(signal);
  return mapResult(described, (format) => pcmReader(bytes, format));
}
