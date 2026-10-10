/**
 * The block layouts of IMA and Microsoft ADPCM, and their checks.
 *
 * A WAV IMA block (code 0x11) is a four-byte header per channel, its first
 * sample and step index, then four-byte words of eight samples, each channel's
 * word in turn, low nibble first. An AIFF-C `ima4` block is a 34-byte packet
 * per channel: a two-byte header, the predictor's top nine bits and the step
 * index, then 64 samples, low nibble first. A Microsoft ADPCM block is seven
 * header bytes per channel, each field for every channel before the next field
 * (the coefficient pair's index, the delta, the second sample, the first), then
 * nibbles high first, the channels interleaved nibble by nibble.
 *
 * A block cut short holds the frames whose every channel's nibbles it holds,
 * which is how a truncated file is read to its last whole frame (ADR-0052).
 */

import { fail, succeed, type DomainResult } from '@audiogubbins/domain';

import { LINEAR_16_SCALE, type BlockCoding } from './block-coding.js';
import { malformed } from './codec-failures.js';
import { IMA_LAST_INDEX, expandIma } from './ima-adpcm.js';
import { expandMs } from './ms-adpcm.js';
import type { ImaAdpcmEncoding, MsAdpcmEncoding } from './sample-encoding.js';

/** The frames of an `ima4` packet, which Apple fixes. */
export const IMA4_FRAMES = 64;

/** The bytes of an `ima4` packet: its header and 64 nibbles. */
export const IMA4_PACKET_BYTES = 34;

/** A WAV IMA block's header per channel, and the word of eight samples each channel takes in turn. */
export const IMA_WAV_HEADER_BYTES = 4;
const IMA_WAV_WORD_BYTES = 4;
const IMA_WAV_WORD_FRAMES = 8;

/** A Microsoft ADPCM block's header per channel, and the frames it holds whole. */
export const MS_HEADER_BYTES = 7;
const MS_HEADER_FRAMES = 2;

/**
 * Decodes frames `from` (inclusive) to `to` (exclusive) of the one block at
 * `offset`, writing frame `from` to index `at`.
 */
type BlockDecoder = (
  view: DataView,
  offset: number,
  from: number,
  to: number,
  into: readonly Float32Array[],
  at: number,
) => DomainResult<undefined>;

/** The part of a block's geometry the run around it is built from. */
interface BlockShape {
  readonly blockBytes: number;
  readonly framesPerBlock: number;
  readonly framesInPart: (bytes: number) => number;
  readonly bytesForPart: (frames: number) => number;
  readonly decodeBlock: BlockDecoder;
}

/** A run of blocks of one shape. */
function runCoding(shape: BlockShape): BlockCoding {
  const { blockBytes, framesPerBlock } = shape;
  return {
    blockBytes,
    framesPerBlock,
    framesIn: (bytes) =>
      Math.floor(bytes / blockBytes) * framesPerBlock + shape.framesInPart(bytes % blockBytes),
    // The last block need hold only its own frames, which may end short of the block's end.
    bytesFor: (frames) =>
      frames === 0
        ? 0
        : Math.floor((frames - 1) / framesPerBlock) * blockBytes +
          shape.bytesForPart(((frames - 1) % framesPerBlock) + 1),
    decode: (bytes, skip, frames, into, at) => {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      let written = 0;
      for (let block = 0; written < frames; block += 1) {
        const from = block === 0 ? skip : 0;
        const to = Math.min(framesPerBlock, from + frames - written);
        const decoded = shape.decodeBlock(view, block * blockBytes, from, to, into, at + written);
        if (!decoded.ok) return decoded;
        written += to - from;
      }
      return succeed(undefined);
    },
  };
}

/** The refusal of a step index past the table, which no encoder writes. */
function badStepIndex(index: number): DomainResult<never> {
  return fail(
    malformed(
      `An IMA ADPCM block states step index ${String(index)}, past the last, ${String(IMA_LAST_INDEX)}.`,
    ),
  );
}

/** A WAV IMA block's decoder for `channelCount` channels. */
function imaWavDecoder(channelCount: number): BlockDecoder {
  const groupBytes = IMA_WAV_WORD_BYTES * channelCount;
  const headerBytes = IMA_WAV_HEADER_BYTES * channelCount;
  return (view, offset, from, to, into, at) => {
    for (const [channel, target] of into.entries()) {
      const header = offset + channel * IMA_WAV_HEADER_BYTES;
      const state = { predictor: view.getInt16(header, true), index: view.getUint8(header + 2) };
      if (state.index > IMA_LAST_INDEX) return badStepIndex(state.index);
      if (from === 0) target[at] = state.predictor / LINEAR_16_SCALE;
      for (let frame = 1; frame < to; frame += 1) {
        const position = frame - 1;
        const byte = view.getUint8(
          offset +
            headerBytes +
            Math.floor(position / IMA_WAV_WORD_FRAMES) * groupBytes +
            channel * IMA_WAV_WORD_BYTES +
            ((position % IMA_WAV_WORD_FRAMES) >> 1),
        );
        const sample = expandIma(state, position % 2 === 0 ? byte & 0x0f : byte >> 4);
        if (frame >= from) target[at + frame - from] = sample / LINEAR_16_SCALE;
      }
    }
    return succeed(undefined);
  };
}

/** An `ima4` packet's decoder: each channel's packet in turn. */
const ima4Decoder: BlockDecoder = (view, offset, from, to, into, at) => {
  for (const [channel, target] of into.entries()) {
    const packet = offset + channel * IMA4_PACKET_BYTES;
    const header = view.getUint16(packet, false);
    // The predictor is the header's top nine bits as a signed 16-bit value.
    const state = { predictor: ((header & 0xff80) << 16) >> 16, index: header & 0x7f };
    if (state.index > IMA_LAST_INDEX) return badStepIndex(state.index);
    for (let frame = 0; frame < to; frame += 1) {
      const byte = view.getUint8(packet + 2 + (frame >> 1));
      const sample = expandIma(state, frame % 2 === 0 ? byte & 0x0f : byte >> 4);
      if (frame >= from) target[at + frame - from] = sample / LINEAR_16_SCALE;
    }
  }
  return succeed(undefined);
};

/**
 * The block coding of IMA ADPCM for `channelCount` channels in blocks of
 * `blockAlign` bytes, or why the header's block cannot be one.
 */
export function imaBlockCoding(
  encoding: ImaAdpcmEncoding,
  channelCount: number,
  blockAlign: number,
): DomainResult<BlockCoding> {
  const { framesPerBlock } = encoding;
  if (encoding.packing === 'ima4') {
    if (blockAlign !== IMA4_PACKET_BYTES * channelCount || framesPerBlock !== IMA4_FRAMES) {
      return fail(malformed('An ima4 block is one 34-byte packet of 64 samples for each channel.'));
    }
    return succeed(
      runCoding({
        blockBytes: blockAlign,
        framesPerBlock,
        // A packet holds no frame until every channel's packet is whole.
        framesInPart: () => 0,
        bytesForPart: (frames) => (frames === 0 ? 0 : blockAlign),
        decodeBlock: ima4Decoder,
      }),
    );
  }
  const headerBytes = IMA_WAV_HEADER_BYTES * channelCount;
  const groupBytes = IMA_WAV_WORD_BYTES * channelCount;
  if (blockAlign < headerBytes || (blockAlign - headerBytes) % groupBytes !== 0) {
    return fail(
      malformed(
        `An IMA ADPCM block of ${String(channelCount)} channels is a ${String(headerBytes)}-byte header and whole ${String(groupBytes)}-byte groups, which ${String(blockAlign)} bytes are not.`,
      ),
    );
  }
  const capacity = ((blockAlign - headerBytes) / groupBytes) * IMA_WAV_WORD_FRAMES + 1;
  if (framesPerBlock < 1 || framesPerBlock > capacity) {
    return fail(
      malformed(
        `The format chunk states ${String(framesPerBlock)} samples in each IMA ADPCM block, where its ${String(blockAlign)} bytes hold 1 to ${String(capacity)}.`,
      ),
    );
  }
  return succeed(
    runCoding({
      blockBytes: blockAlign,
      framesPerBlock,
      framesInPart: (bytes) =>
        bytes < headerBytes
          ? 0
          : Math.min(
              framesPerBlock,
              1 + Math.floor((bytes - headerBytes) / groupBytes) * IMA_WAV_WORD_FRAMES,
            ),
      bytesForPart: (frames) =>
        frames === 0 ? 0 : headerBytes + Math.ceil((frames - 1) / IMA_WAV_WORD_FRAMES) * groupBytes,
      decodeBlock: imaWavDecoder(channelCount),
    }),
  );
}

/** A Microsoft ADPCM block's decoder for `channelCount` channels and the format's coefficients. */
function msDecoder(
  channelCount: number,
  coefficients: MsAdpcmEncoding['coefficients'],
): BlockDecoder {
  const field = (offset: number, index: number, channel: number) =>
    offset + channelCount * index + 2 * channel;
  return (view, offset, from, to, into, at) => {
    for (const [channel, target] of into.entries()) {
      const chosen = view.getUint8(offset + channel);
      const pair = coefficients[chosen];
      if (pair === undefined) {
        return fail(
          malformed(
            `A Microsoft ADPCM block chooses coefficient pair ${String(chosen)}, where the format chunk lists ${String(coefficients.length)}.`,
          ),
        );
      }
      const state = {
        delta: view.getInt16(field(offset, 1, channel), true),
        sample1: view.getInt16(field(offset, 3, channel), true),
        sample2: view.getInt16(field(offset, 5, channel), true),
        coefficient1: pair[0],
        coefficient2: pair[1],
      };
      // The header holds the block's first two samples whole, the earlier one second.
      const opening = [state.sample2, state.sample1];
      for (let frame = from; frame < Math.min(to, MS_HEADER_FRAMES); frame += 1) {
        target[at + frame - from] = (opening[frame] ?? 0) / LINEAR_16_SCALE;
      }
      const nibbles = offset + MS_HEADER_BYTES * channelCount;
      for (let frame = MS_HEADER_FRAMES; frame < to; frame += 1) {
        const position = (frame - MS_HEADER_FRAMES) * channelCount + channel;
        const byte = view.getUint8(nibbles + (position >> 1));
        const sample = expandMs(state, position % 2 === 0 ? byte >> 4 : byte & 0x0f);
        if (frame >= from) target[at + frame - from] = sample / LINEAR_16_SCALE;
      }
    }
    return succeed(undefined);
  };
}

/**
 * The block coding of Microsoft ADPCM for `channelCount` channels in blocks of
 * `blockAlign` bytes, or why the header's block cannot be one.
 */
export function msBlockCoding(
  encoding: MsAdpcmEncoding,
  channelCount: number,
  blockAlign: number,
): DomainResult<BlockCoding> {
  const headerBytes = MS_HEADER_BYTES * channelCount;
  const { framesPerBlock } = encoding;
  const capacity = MS_HEADER_FRAMES + Math.floor(((blockAlign - headerBytes) * 2) / channelCount);
  if (blockAlign < headerBytes || framesPerBlock < MS_HEADER_FRAMES || framesPerBlock > capacity) {
    return fail(
      malformed(
        `The format chunk states ${String(framesPerBlock)} samples in each ${String(blockAlign)}-byte Microsoft ADPCM block of ${String(channelCount)} channels, which cannot hold them.`,
      ),
    );
  }
  return succeed(
    runCoding({
      blockBytes: blockAlign,
      framesPerBlock,
      framesInPart: (bytes) =>
        bytes < headerBytes
          ? 0
          : Math.min(
              framesPerBlock,
              MS_HEADER_FRAMES + Math.floor(((bytes - headerBytes) * 2) / channelCount),
            ),
      bytesForPart: (frames) =>
        frames === 0
          ? 0
          : headerBytes +
            Math.ceil(((Math.max(frames, MS_HEADER_FRAMES) - MS_HEADER_FRAMES) * channelCount) / 2),
      decodeBlock: msDecoder(channelCount, encoding.coefficients),
    }),
  );
}
