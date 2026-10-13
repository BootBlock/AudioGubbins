/**
 * The MD5 signature FLAC's stream information states of the samples it was
 * encoded from (RFC 9639, section 8.2).
 *
 * The signature is of the samples as the format defines them for it:
 * interleaved, each sample a signed little-endian integer in as few whole bytes
 * as its bit depth needs. The codec worker hands the integer samples it gives
 * the encoder to this as well, a block at a time, and the FLAC writer takes the
 * digest and the count of frames at the end, so the count the frames state is
 * checked against the count the samples had.
 */

import { Md5 } from './md5.js';

/** The signature of a stream's samples, being computed. */
export class FlacSampleDigest {
  private readonly md5 = new Md5();
  private readonly bytesPerSample: number;
  private counted = 0;

  constructor(bitsPerSample: number) {
    this.bytesPerSample = Math.ceil(bitsPerSample / 8);
  }

  /** The frames added so far. */
  get frames(): number {
    return this.counted;
  }

  /** Adds `frames` frames of planar integer samples, one array per channel. */
  add(channels: readonly Int32Array[], frames: number): void {
    const width = this.bytesPerSample;
    const bytes = new Uint8Array(frames * channels.length * width);
    let at = 0;
    for (let frame = 0; frame < frames; frame += 1) {
      for (const channel of channels) {
        const sample = channel[frame] ?? 0;
        for (let byte = 0; byte < width; byte += 1) {
          bytes[at] = (sample >> (8 * byte)) & 0xff;
          at += 1;
        }
      }
    }
    this.md5.update(bytes);
    this.counted += frames;
  }

  /** The 16-byte signature. The digest is spent once it is taken. */
  digest(): Uint8Array {
    return this.md5.digest();
  }
}
