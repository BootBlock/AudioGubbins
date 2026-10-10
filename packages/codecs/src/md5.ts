/**
 * MD5 (RFC 1321), which FLAC's stream information states of the samples it was
 * encoded from.
 *
 * Written in portable TypeScript because this package runs in workers and tests
 * with no host's crypto, and a FLAC file must carry the same signature on every
 * machine. MD5 is here a checksum the format names, never a defence against
 * tampering. The digest is incremental: the samples arrive a block at a time
 * and are never held whole.
 */

/** The per-round shift amounts, RFC 1321 section 3.4. */
const SHIFTS = Uint8Array.from([
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
  20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6,
  10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
]);

/** The sine table, the integer part of 2^32 * |sin(i + 1)|. */
const SINES = Int32Array.from({ length: 64 }, (_, index) =>
  Math.floor(Math.abs(Math.sin(index + 1)) * 2 ** 32),
);

const BLOCK_BYTES = 64;

/** An MD5 digest being computed. */
export class Md5 {
  private readonly state = Int32Array.from([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]);
  private readonly block = new Uint8Array(BLOCK_BYTES);
  private readonly words = new Int32Array(16);
  private buffered = 0;
  private total = 0;

  /** Adds bytes to the message. */
  update(bytes: Uint8Array): void {
    this.total += bytes.length;
    let offset = 0;
    if (this.buffered > 0) {
      const taken = Math.min(BLOCK_BYTES - this.buffered, bytes.length);
      this.block.set(bytes.subarray(0, taken), this.buffered);
      this.buffered += taken;
      offset = taken;
      if (this.buffered < BLOCK_BYTES) return;
      this.compress(this.block, 0);
      this.buffered = 0;
    }
    for (; offset + BLOCK_BYTES <= bytes.length; offset += BLOCK_BYTES)
      this.compress(bytes, offset);
    this.block.set(bytes.subarray(offset), 0);
    this.buffered = bytes.length - offset;
  }

  /** The 16-byte digest of every byte added. The digest is spent once it is taken. */
  digest(): Uint8Array {
    const bits = this.total * 8;
    const padding = new Uint8Array((this.buffered < 56 ? 56 : 120) - this.buffered + 8);
    padding[0] = 0x80;
    const view = new DataView(padding.buffer);
    view.setUint32(padding.length - 8, bits % 2 ** 32, true);
    view.setUint32(padding.length - 4, Math.floor(bits / 2 ** 32), true);
    this.update(padding);
    const digest = new Uint8Array(16);
    const out = new DataView(digest.buffer);
    this.state.forEach((word, index) => {
      out.setInt32(index * 4, word, true);
    });
    return digest;
  }

  private compress(bytes: Uint8Array, offset: number): void {
    const words = this.words;
    for (let index = 0; index < 16; index += 1) {
      const at = offset + index * 4;
      words[index] =
        (bytes[at] ?? 0) |
        ((bytes[at + 1] ?? 0) << 8) |
        ((bytes[at + 2] ?? 0) << 16) |
        ((bytes[at + 3] ?? 0) << 24);
    }
    let a = this.state[0] ?? 0;
    let b = this.state[1] ?? 0;
    let c = this.state[2] ?? 0;
    let d = this.state[3] ?? 0;
    for (let round = 0; round < 64; round += 1) {
      let mixed: number;
      let word: number;
      if (round < 16) {
        mixed = (b & c) | (~b & d);
        word = round;
      } else if (round < 32) {
        mixed = (d & b) | (~d & c);
        word = (5 * round + 1) % 16;
      } else if (round < 48) {
        mixed = b ^ c ^ d;
        word = (3 * round + 5) % 16;
      } else {
        mixed = c ^ (b | ~d);
        word = (7 * round) % 16;
      }
      const sum = (a + mixed + (SINES[round] ?? 0) + (words[word] ?? 0)) | 0;
      const shift = SHIFTS[round] ?? 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0;
    }
    this.state[0] = ((this.state[0] ?? 0) + a) | 0;
    this.state[1] = ((this.state[1] ?? 0) + b) | 0;
    this.state[2] = ((this.state[2] ?? 0) + c) | 0;
    this.state[3] = ((this.state[3] ?? 0) + d) | 0;
  }
}
