/**
 * Vorbis header and audio packets written here, as libvorbis lays them out,
 * for the Ogg Vorbis writer's tests: an identification header of the block
 * sizes asked for, a comment header of an encoder's vendor string, and a
 * setup header whose every part is the smallest the specification allows,
 * ending in the modes asked for. An audio packet names its mode in the bits
 * after its type bit, as an encoder's does.
 */

import { concatenate } from '../byte-writer.js';
import { encodeVorbisComment } from '../vorbis-comment.js';

/** Bits packed least significant first, as Vorbis packs them. */
class BitPacker {
  readonly #bytes: number[] = [];
  #bit = 0;

  write(value: number, count: number): this {
    for (let index = 0; index < count; index += 1) {
      if (this.#bit % 8 === 0) this.#bytes.push(0);
      const at = this.#bytes.length - 1;
      this.#bytes[at] =
        (this.#bytes[at] ?? 0) | ((Math.floor(value / 2 ** index) % 2) << (this.#bit % 8));
      this.#bit += 1;
    }
    return this;
  }

  get bytes(): Uint8Array {
    return Uint8Array.from(this.#bytes);
  }
}

const header = (type: number, body: Uint8Array): Uint8Array =>
  concatenate([Uint8Array.of(type, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73), body]);

/** An identification header of `channels` at 48 kHz with blocks of 2^`short` and 2^`long` samples. */
export function vorbisIdentification(channels: number, short = 8, long = 11): Uint8Array {
  const body = new Uint8Array(23);
  const view = new DataView(body.buffer);
  view.setUint32(0, 0, true);
  body[4] = channels;
  view.setUint32(5, 48_000, true);
  body[21] = short | (long << 4);
  body[22] = 1;
  return header(1, body);
}

/** A comment header of `vendor` and one comment of its own, as an encoder writes one. */
export function vorbisComment(vendor: string): Uint8Array {
  const block = encodeVorbisComment(
    { text: { title: 'Encoder title' } },
    { vendor, pictureField: false },
  );
  return header(3, concatenate([block.bytes, Uint8Array.of(1)]));
}

/** A setup header of one codebook, floor 1, residue 0 and mapping, and `modes`, true for a long block. */
export function vorbisSetup(modes: readonly boolean[]): Uint8Array {
  const bits = new BitPacker();
  // One codebook of one dimension and two entries, each one bit long, with no lookup.
  bits.write(0, 8).write(0x564342, 24).write(1, 16).write(2, 24);
  bits.write(0, 1).write(0, 1).write(0, 5).write(0, 5).write(0, 4);
  // One time-domain value, zero.
  bits.write(0, 6).write(0, 16);
  // One floor of type 1 with no partitions, a multiplier of 1 and 4 range bits.
  bits.write(0, 6).write(1, 16).write(0, 5).write(0, 2).write(4, 4);
  // One residue of type 0 with one classification.
  bits.write(0, 6).write(0, 16).write(0, 24).write(0, 24).write(0, 24);
  bits.write(0, 6).write(0, 8).write(0, 3).write(0, 1);
  // One mapping of one submap, no coupling.
  bits.write(0, 6).write(0, 16).write(0, 1).write(0, 1).write(0, 2);
  bits.write(0, 8).write(0, 8).write(0, 8);
  // The modes, then the framing bit.
  bits.write(modes.length - 1, 6);
  for (const long of modes) {
    bits
      .write(long ? 1 : 0, 1)
      .write(0, 16)
      .write(0, 16)
      .write(0, 8);
  }
  bits.write(1, 1);
  return header(5, bits.bytes);
}

/** An audio packet of mode `mode`, of a stream of `modes` modes, `length` bytes long. */
export function vorbisAudioPacket(
  mode: number,
  modes: number,
  length: number,
  seed = 0,
): Uint8Array {
  const packet = Uint8Array.from({ length }, (_, index) => (index * 11 + seed) & 0xff);
  const modeBits = modes <= 1 ? 0 : 32 - Math.clz32(modes - 1);
  const mask = ((1 << modeBits) - 1) << 1;
  packet[0] = ((packet[0] ?? 0) & ~mask & ~1) | ((mode << 1) & mask);
  return packet;
}
