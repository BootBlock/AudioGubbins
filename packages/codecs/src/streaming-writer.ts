/**
 * The `AudioFileWriter` contract's one implementation of its stream: what every
 * file writer does the same way, whatever its format (ADR-0090, ADR-0092).
 *
 * It checks each block it is handed, puts the channels into the order the file
 * holds them in, encodes them, counts the frames and the bytes, and refuses a
 * stream past the most its format can hold before a byte past it is answered,
 * so an export that cannot be whole fails rather than ending as a file that
 * says less than it holds. A call that fails ends the writer, as one finished
 * does. The format's own part, its head once the length is known, is the
 * caller's `head`.
 */

import {
  fail,
  succeed,
  throwIfCancelled,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';

import type { AudioFileWriter, FinishedAudioFile, SamplePlane } from './audio-file-writer.js';
import { writeInvalid } from './codec-failures.js';
import type { FrameEncoder } from './frame-encoder.js';
import type { MetadataPart } from './metadata-map.js';

/** What a stream came to: its frames and the bytes of its samples. */
export interface WrittenStream {
  readonly frames: number;
  readonly dataLength: number;
}

/** The format's part of a writer. */
export interface StreamFormat {
  /** For each channel of the file, the index of the channel it is in the blocks handed in. */
  readonly order: readonly number[];
  readonly encoder: FrameEncoder;

  /** The most bytes of samples, and the most frames, the format can hold. */
  readonly maximumDataLength: number;
  readonly maximumFrames: number;

  /** Why a stream past those cannot be written, naming the formats that can hold it. */
  readonly tooLong: () => DomainFailure;

  /** The head of the finished stream. */
  readonly head: (stream: WrittenStream) => DomainResult<Uint8Array>;

  /** The parts of the metadata the format cannot hold. */
  readonly dropped: readonly MetadataPart[];
}

/** Why a block cannot be written, or `undefined` where it can. */
function blockProblem(
  channels: readonly SamplePlane[],
  frames: number,
  channelCount: number,
): string | undefined {
  if (!Number.isSafeInteger(frames) || frames < 0) {
    return 'A block written holds a whole number of frames, none or more.';
  }
  if (channels.length !== channelCount) {
    return `A block written holds ${String(channelCount)} channels, one array for each.`;
  }
  return channels.some((channel) => channel.length < frames)
    ? 'Each array of a block written must hold its frames.'
    : undefined;
}

/** A writer of one stream in `format`. */
export function streamingWriter(format: StreamFormat): AudioFileWriter {
  const { encoder, order } = format;
  let open = true;
  let frames = 0;
  let dataLength = 0;
  const ended = (failure: DomainFailure): DomainResult<never> => {
    open = false;
    return fail(failure);
  };
  return {
    write: async (channels, count, signal) => {
      await Promise.resolve();
      throwIfCancelled(signal);
      if (!open) return fail(writeInvalid('A writer that has finished or failed takes no more.'));
      const problem = blockProblem(channels, count, order.length);
      if (problem !== undefined) return ended(writeInvalid(problem));
      if (frames + count > format.maximumFrames) return ended(format.tooLong());
      const body = encoder.encode(
        order.map((index) => channels[index] ?? new Float32Array(count)),
        count,
      );
      frames += count;
      dataLength += body.length;
      // A block code's last block is answered at the end, so it is counted against the limit now.
      if (dataLength + encoder.blockBytes > format.maximumDataLength)
        return ended(format.tooLong());
      return succeed(body.length === 0 ? [] : [body]);
    },
    finish: async (signal) => {
      await Promise.resolve();
      throwIfCancelled(signal);
      if (!open) return fail(writeInvalid('A writer that has finished or failed takes no more.'));
      open = false;
      const last = encoder.finish();
      const length = dataLength + last.length;
      const head = format.head({ frames, dataLength: length });
      if (!head.ok) return head;
      const tail = new Uint8Array(last.length + (length % 2));
      tail.set(last);
      const finished: FinishedAudioFile = { head: head.value, tail, dropped: format.dropped };
      return succeed(finished);
    },
  };
}
