/**
 * The codec module's Opus decoder against the RFC 6716 and RFC 8251
 * conformance vectors (ADR-0091; `pnpm test:opus-conformance`).
 *
 * Each of the twelve bitstreams is decoded by the built module, to one
 * channel and to two at 48 kHz, as the reference's `run_vectors.sh` does: the
 * range coder's final state after each packet must be the one the bitstream
 * records, and the output must reach `opus_compare`'s threshold against
 * either reference output. A decoder that fails a vector fails the build.
 * Not part of `verify:commit`: the vectors are fetched on demand.
 */

import { describe, expect, it } from 'vitest';

import { MAX_OPUS_PACKET_FRAMES } from '@audiogubbins/codec-runtime';
import { codecModule } from '@audiogubbins/codec-runtime/testing';

import { opusQuality } from './opus-compare.js';
import { opusVectors } from './opus-vectors.js';

/** The vectors, by number. */
const VECTORS = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0'));

/** A file's 16-bit little-endian samples, as numbers of that scale. */
function samplesOf(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Float32Array.from({ length: bytes.length / 2 }, (_, index) =>
    view.getInt16(index * 2, true),
  );
}

/** What decoding one bitstream gave. */
interface Decoded {
  readonly samples: Float32Array;
  readonly rangeMismatches: number;
}

/**
 * Decodes a bitstream as the reference's demonstration decoder reads one: a
 * big-endian length, the encoder's final range, then the packet, for each.
 */
async function decode(bitstream: Uint8Array, channels: 1 | 2): Promise<Decoded> {
  const module = await codecModule();
  const made = module.createOpusPacketDecoder(channels);
  if (!made.ok) throw new Error(made.failures[0].summary);
  const decoder = made.value;
  const view = new DataView(bitstream.buffer, bitstream.byteOffset, bitstream.byteLength);
  const planes = Array.from({ length: channels }, () => new Float32Array(MAX_OPUS_PACKET_FRAMES));
  const out: number[] = [];
  let rangeMismatches = 0;
  for (let at = 0; at + 8 <= bitstream.length;) {
    const length = view.getUint32(at);
    const range = view.getUint32(at + 4);
    const packet = bitstream.subarray(at + 8, at + 8 + length);
    at += 8 + length;
    const frames = decoder.decode(packet, planes);
    if (!frames.ok) throw new Error(`a packet would not decode: ${frames.failures[0].code}`);
    if (length > 0 && decoder.finalRange() !== range) rangeMismatches += 1;
    for (let frame = 0; frame < frames.value; frame += 1) {
      for (const plane of planes) out.push((plane[frame] ?? 0) * 32_768);
    }
  }
  decoder.release();
  return { samples: Float32Array.from(out), rangeMismatches };
}

describe('the Opus decoder against the conformance vectors', async () => {
  const files = await opusVectors();
  const file = (name: string): Uint8Array => {
    const found = files.get(name);
    if (found === undefined) throw new Error(`The vectors hold no ${name}.`);
    return found;
  };

  for (const channels of [1, 2] as const) {
    for (const vector of VECTORS) {
      it(`decodes testvector${vector} to ${String(channels)} channel(s) within the threshold`, async ({
        annotate,
      }) => {
        const decoded = await decode(file(`testvector${vector}.bit`), channels);
        expect(decoded.rangeMismatches).toBe(0);
        // Either reference output conforms; the second is read only where
        // the first does not.
        const first = opusQuality(
          samplesOf(file(`testvector${vector}.dec`)),
          decoded.samples,
          channels,
        );
        const quality =
          first !== undefined && first >= 0
            ? first
            : opusQuality(samplesOf(file(`testvector${vector}m.dec`)), decoded.samples, channels);
        await annotate(
          `testvector${vector}, ${String(channels)} channel(s): quality ${quality === undefined ? 'unmeasured (lengths differ)' : `${quality.toFixed(1)} %`}`,
        );
        expect(quality).toBeGreaterThanOrEqual(0);
      });
    }
  }
});
