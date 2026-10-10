/**
 * Encoding planar float samples into the bytes a file stores, the inverse of
 * the block codings the read contract decodes by.
 *
 * Integer PCM takes each sample through `quantiseSample`, the one quantisation
 * rule the dither shares (ADR-0092), and nothing else; 32-bit float copies each
 * sample's bits, so a round trip is bit for bit, a NaN's payload included; 64-bit
 * float widens each exactly. G.711 and ADPCM quantise to 16 bits by the same
 * rule and then compand or code. A block code holds frames until a block is
 * whole, and pads the last block with silence when the stream ends; the file's
 * length is stated apart from its blocks (`fact` in WAV).
 */

import { adpcmEncoder } from './adpcm-encoding.js';
import type { FrameEncoder } from './frame-encoder.js';
import { compressAlaw, compressUlaw } from './g711.js';
import type { SampleEncoding } from './sample-encoding.js';
import { quantiseSample } from './sample-quantisation.js';

/** Writes one sample's value at a byte offset. */
type SampleWriter = (view: DataView, offset: number, channel: Float32Array, frame: number) => void;

/** The writer of one sample in an uncompressed or G.711 encoding. */
function sampleWriter(encoding: SampleEncoding): {
  readonly bytes: number;
  readonly write: SampleWriter;
} {
  switch (encoding.kind) {
    case 'integer': {
      const littleEndian = encoding.byteOrder === 'little';
      const { bits, bytes } = encoding;
      const shift = 2 ** (bytes * 8 - bits);
      const bias = encoding.signed ? 0 : 2 ** (bytes * 8 - 1);
      return {
        bytes,
        write: (view, offset, channel, frame) => {
          const value = quantiseSample(channel[frame] ?? 0, bits) * shift + bias;
          const unsigned = value < 0 ? value + 2 ** (bytes * 8) : value;
          for (let index = 0; index < bytes; index += 1) {
            const byte = Math.floor(unsigned / 2 ** (index * 8)) % 256;
            view.setUint8(littleEndian ? offset + index : offset + bytes - 1 - index, byte);
          }
        },
      };
    }
    case 'float': {
      const littleEndian = encoding.byteOrder === 'little';
      if (encoding.bits === 64) {
        return {
          bytes: 8,
          write: (view, offset, channel, frame) => {
            view.setFloat64(offset, channel[frame] ?? 0, littleEndian);
          },
        };
      }
      return {
        bytes: 4,
        write: (view, offset, channel, frame) => {
          // Through an integer view, so a NaN's payload is not lost to a number on the way.
          const bits = new Uint32Array(channel.buffer, channel.byteOffset, channel.length);
          view.setUint32(offset, bits[frame] ?? 0, littleEndian);
        },
      };
    }
    default: {
      const compress = encoding.kind === 'g711-alaw' ? compressAlaw : compressUlaw;
      return {
        bytes: 1,
        write: (view, offset, channel, frame) => {
          view.setUint8(offset, compress(quantiseSample(channel[frame] ?? 0, 16)));
        },
      };
    }
  }
}

/** An encoder whose block is one frame of `channelCount` samples, none held back. */
function frameEncoder(encoding: SampleEncoding, channelCount: number): FrameEncoder {
  const { bytes, write } = sampleWriter(encoding);
  const blockBytes = bytes * channelCount;
  return {
    blockBytes,
    framesPerBlock: 1,
    encode: (channels, frames) => {
      const out = new Uint8Array(frames * blockBytes);
      const view = new DataView(out.buffer);
      for (const [index, channel] of channels.entries()) {
        for (let frame = 0; frame < frames; frame += 1) {
          write(view, frame * blockBytes + index * bytes, channel, frame);
        }
      }
      return out;
    },
    finish: () => new Uint8Array(0),
  };
}

/** The encoder of `encoding` for `channelCount` channels. */
export function encoderOf(encoding: SampleEncoding, channelCount: number): FrameEncoder {
  return encoding.kind === 'ima-adpcm' || encoding.kind === 'ms-adpcm'
    ? adpcmEncoder(encoding, channelCount)
    : frameEncoder(encoding, channelCount);
}
