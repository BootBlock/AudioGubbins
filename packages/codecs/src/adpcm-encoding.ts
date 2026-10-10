/**
 * Encoding IMA and Microsoft ADPCM blocks, in the layouts `adpcm-blocks.ts`
 * reads (ADR-0091).
 *
 * The block size follows Microsoft's own encoders: 256 bytes a channel at 11
 * 025 Hz and below, doubling with the rate up to 1 024 bytes from 44 100 Hz,
 * and never past the 65 535 bytes a WAV block align can state. Each block's
 * header holds what the decoder starts from, the encoder starts from that same
 * state, and each nibble it chooses is expanded by the decoder's own expansion,
 * so the samples a file decodes to are those the encoder tracked. The IMA step
 * index and the Microsoft delta carry from block to block, as the reference
 * encoders carry them; a Microsoft block's coefficient pair is the one of the
 * seven standard pairs whose coding of that block errs least, the first on a
 * tie, so the choice is the same on every machine.
 */

import {
  IMA4_FRAMES,
  IMA4_PACKET_BYTES,
  IMA_WAV_HEADER_BYTES,
  MS_HEADER_BYTES,
} from './adpcm-blocks.js';
import type { FrameEncoder } from './frame-encoder.js';
import { compressIma, type ImaState } from './ima-adpcm.js';
import { STANDARD_COEFFICIENTS, compressMs, type MsState } from './ms-adpcm.js';
import type { ImaAdpcmEncoding, MsAdpcmEncoding } from './sample-encoding.js';
import { quantiseSample } from './sample-quantisation.js';

/** The largest block align a WAV format chunk states. */
const LARGEST_BLOCK_ALIGN = 0xffff;

/** The rate at and below which a block is 256 bytes a channel, and the most it doubles. */
const BASE_RATE = 11_025;
const BASE_CHANNEL_BYTES = 256;
const LARGEST_MULTIPLE = 4;

/** The bytes of a WAV IMA word: eight samples of one channel. */
const IMA_WORD_BYTES = 4;

/** The largest int16, the most a Microsoft block header's delta holds. */
const LARGEST_HEADER_DELTA = 32_767;

/** The bytes of each channel's share of a block at `sampleRate`, for `channelCount` channels. */
function channelBytes(sampleRate: number, channelCount: number): number {
  const multiple = Math.min(LARGEST_MULTIPLE, Math.max(1, Math.floor(sampleRate / BASE_RATE)));
  const fitting = Math.floor(LARGEST_BLOCK_ALIGN / channelCount / 4) * 4;
  return Math.min(BASE_CHANNEL_BYTES * multiple, fitting);
}

/** The IMA ADPCM encoding a WAV or AIFF-C writer writes at a rate, in its container's packing. */
export function imaEncodingFor(
  packing: 'wav' | 'ima4',
  sampleRate: number,
  channelCount: number,
): ImaAdpcmEncoding {
  if (packing === 'ima4') return { kind: 'ima-adpcm', packing, framesPerBlock: IMA4_FRAMES };
  const bytes = channelBytes(sampleRate, channelCount);
  return { kind: 'ima-adpcm', packing, framesPerBlock: (bytes - IMA_WAV_HEADER_BYTES) * 2 + 1 };
}

/** The Microsoft ADPCM encoding a WAV writer writes at a rate. */
export function msEncodingFor(sampleRate: number, channelCount: number): MsAdpcmEncoding {
  const bytes = channelBytes(sampleRate, channelCount);
  return {
    kind: 'ms-adpcm',
    framesPerBlock: (bytes - MS_HEADER_BYTES) * 2 + 2,
    coefficients: STANDARD_COEFFICIENTS,
  };
}

/** The block align of an ADPCM encoding for `channelCount` channels. */
export function adpcmBlockAlign(
  encoding: ImaAdpcmEncoding | MsAdpcmEncoding,
  channelCount: number,
): number {
  if (encoding.kind === 'ms-adpcm') {
    return ((encoding.framesPerBlock - 2) / 2 + MS_HEADER_BYTES) * channelCount;
  }
  if (encoding.packing === 'ima4') return IMA4_PACKET_BYTES * channelCount;
  return ((encoding.framesPerBlock - 1) / 2 + IMA_WAV_HEADER_BYTES) * channelCount;
}

/** Codes one whole block of 16-bit samples, a row per channel, into `out`. */
type BlockCoder = (samples: readonly Int16Array[], out: Uint8Array) => void;

/** Sets the nibble at `position` of a run of bytes, low nibble first or high nibble first. */
function setNibble(
  out: Uint8Array,
  at: number,
  position: number,
  nibble: number,
  lowFirst: boolean,
): void {
  const index = at + (position >> 1);
  const low = (position % 2 === 0) === lowFirst;
  out[index] = low
    ? ((out[index] ?? 0) & 0xf0) | nibble
    : ((out[index] ?? 0) & 0x0f) | (nibble << 4);
}

/** WAV IMA blocks: each channel's first sample whole, then its words of eight in turn. */
function imaWavCoder(channelCount: number, states: ImaState[]): BlockCoder {
  const headerBytes = IMA_WAV_HEADER_BYTES * channelCount;
  return (samples, out) => {
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    for (const [channel, row] of samples.entries()) {
      const state = states[channel] ?? { predictor: 0, index: 0 };
      state.predictor = row[0] ?? 0;
      view.setInt16(IMA_WAV_HEADER_BYTES * channel, state.predictor, true);
      view.setUint8(IMA_WAV_HEADER_BYTES * channel + 2, state.index);
      for (let frame = 1; frame < row.length; frame += 1) {
        const position = frame - 1;
        const word = headerBytes + (position >> 3) * IMA_WORD_BYTES * channelCount;
        const at = word + IMA_WORD_BYTES * channel;
        setNibble(out, at, position % 8, compressIma(state, row[frame] ?? 0), true);
      }
    }
  };
}

/** AIFF-C `ima4` packets: each channel's packet from the predictor its header can hold. */
function ima4Coder(states: ImaState[]): BlockCoder {
  return (samples, out) => {
    for (const [channel, row] of samples.entries()) {
      const state = states[channel] ?? { predictor: 0, index: 0 };
      const packet = channel * IMA4_PACKET_BYTES;
      // The header keeps the predictor's top nine bits, which is all the decoder resumes from.
      const header = (state.predictor & 0xff80) | state.index;
      out[packet] = (header >> 8) & 0xff;
      out[packet + 1] = header & 0xff;
      state.predictor = ((header & 0xff80) << 16) >> 16;
      for (let frame = 0; frame < row.length; frame += 1) {
        setNibble(out, packet + 2, frame, compressIma(state, row[frame] ?? 0), true);
      }
    }
  };
}

/** The squared error of coding `row` from `state`, which the trial moves on. */
function trialError(state: MsState, row: Int16Array): number {
  let error = 0;
  for (let frame = 2; frame < row.length; frame += 1) {
    const sample = row[frame] ?? 0;
    compressMs(state, sample);
    error += (state.sample1 - sample) ** 2;
  }
  return error;
}

/** Microsoft ADPCM blocks: each header field for every channel, then nibbles high first. */
function msCoder(channelCount: number, deltas: number[]): BlockCoder {
  return (samples, out) => {
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    const field = (index: number, channel: number) => channelCount * index + 2 * channel;
    for (const [channel, row] of samples.entries()) {
      const delta = Math.min(deltas[channel] ?? 16, LARGEST_HEADER_DELTA);
      const start = (pair: readonly [number, number]): MsState => ({
        sample1: row[1] ?? 0,
        sample2: row[0] ?? 0,
        delta,
        coefficient1: pair[0],
        coefficient2: pair[1],
      });
      const errors = STANDARD_COEFFICIENTS.map((pair) => trialError(start(pair), row));
      const chosen = errors.indexOf(Math.min(...errors));
      const state = start(STANDARD_COEFFICIENTS[chosen] ?? [256, 0]);
      out[channel] = chosen;
      view.setInt16(field(1, channel), delta, true);
      view.setInt16(field(3, channel), state.sample1, true);
      view.setInt16(field(5, channel), state.sample2, true);
      for (let frame = 2; frame < row.length; frame += 1) {
        const position = (frame - 2) * channelCount + channel;
        setNibble(
          out,
          MS_HEADER_BYTES * channelCount,
          position,
          compressMs(state, row[frame] ?? 0),
          false,
        );
      }
      deltas[channel] = state.delta;
    }
  };
}

/** An ADPCM encoder, holding frames until each block is whole. */
export function adpcmEncoder(
  encoding: ImaAdpcmEncoding | MsAdpcmEncoding,
  channelCount: number,
): FrameEncoder {
  const { framesPerBlock } = encoding;
  const blockBytes = adpcmBlockAlign(encoding, channelCount);
  const imaStates = Array.from({ length: channelCount }, (): ImaState => ({
    predictor: 0,
    index: 0,
  }));
  const coder =
    encoding.kind === 'ms-adpcm'
      ? msCoder(channelCount, new Array<number>(channelCount).fill(16))
      : encoding.packing === 'ima4'
        ? ima4Coder(imaStates)
        : imaWavCoder(channelCount, imaStates);
  const pending = Array.from({ length: channelCount }, () => new Int16Array(framesPerBlock));
  let held = 0;
  const codeBlock = (out: Uint8Array, at: number) => {
    coder(pending, out.subarray(at, at + blockBytes));
    held = 0;
  };
  return {
    blockBytes,
    framesPerBlock,
    encode: (channels, frames) => {
      const blocks = Math.floor((held + frames) / framesPerBlock);
      const out = new Uint8Array(blocks * blockBytes);
      let written = 0;
      for (let frame = 0; frame < frames; frame += 1) {
        for (const [channel, row] of pending.entries()) {
          row[held] = quantiseSample(channels[channel]?.[frame] ?? 0, 16);
        }
        held += 1;
        if (held === framesPerBlock) {
          codeBlock(out, written);
          written += blockBytes;
        }
      }
      return out;
    },
    finish: () => {
      if (held === 0) return new Uint8Array(0);
      for (const row of pending) row.fill(0, held);
      const out = new Uint8Array(blockBytes);
      codeBlock(out, 0);
      return out;
    },
  };
}
