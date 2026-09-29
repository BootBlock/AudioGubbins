/**
 * A render sink that keeps a fingerprint of the audio and none of the audio.
 *
 * The fingerprint is FNV-1a, 64 bits, over each sample's bits in little-endian
 * order, as the engine's golden tests and the crates' own compute it
 * (ADR-0032), so the same render gives the same number on every machine and on
 * either DSP path. It runs over the samples in frame order with the channels
 * interleaved, which is the one order a sink can hash chunk by chunk: the
 * golden tests' order, every left sample before any right one, needs the whole
 * of a channel held until the last chunk, which is what a long render must
 * never do.
 *
 * The 64-bit state is two 32-bit halves in ordinary numbers rather than a
 * `bigint`: a ten-second stereo render is nearly four million bytes, and a
 * `bigint` operation per byte would make hashing a render slower than
 * rendering it.
 */

import type { AudioFrameBlock, RenderSink } from '@audiogubbins/audio-engine';

/** The FNV-1a-64 offset basis, `0xcbf29ce484222325`, in halves. */
const OFFSET_HIGH = 0xcb_f2_9c_e4;
const OFFSET_LOW = 0x84_22_23_25;

/**
 * The low part of the FNV-1a-64 prime, `0x100000001b3`. The prime is
 * `2^40 + 0x1b3`, so a product is the state times `0x1b3` plus the state
 * shifted up forty bits, of which only the low half survives, in the high half.
 */
const PRIME_LOW = 0x1_b3;

const TWO_TO_THE_32 = 4_294_967_296;

/** A sink that fingerprints what it is written, and how much. */
export interface FingerprintSink extends RenderSink {
  /** The fingerprint of every sample written so far. */
  readonly fingerprint: () => bigint;
  readonly frames: () => number;
}

/** A sink whose fingerprint starts from the offset basis. */
export function fingerprintSink(): FingerprintSink {
  let high = OFFSET_HIGH;
  let low = OFFSET_LOW;
  let frames = 0;

  // One sample's bits, read little-endian whatever the machine's own order.
  const scratch = new DataView(new ArrayBuffer(4));

  const mixByte = (byte: number): void => {
    const mixed = (low ^ byte) >>> 0;
    const lowProduct = mixed * PRIME_LOW;
    // Every intermediate is an integer below 2^53, so each is exact, and the
    // unsigned shifts reduce it modulo 2^32.
    high = (high * PRIME_LOW + Math.floor(lowProduct / TWO_TO_THE_32) + (mixed << 8)) >>> 0;
    low = lowProduct >>> 0;
  };

  const mixSample = (sample: number): void => {
    scratch.setFloat32(0, sample, true);
    const bits = scratch.getUint32(0, true);
    mixByte(bits & 0xff);
    mixByte((bits >>> 8) & 0xff);
    mixByte((bits >>> 16) & 0xff);
    mixByte(bits >>> 24);
  };

  return {
    write: (block: AudioFrameBlock) => {
      const { channels } = block;
      for (let frame = 0; frame < block.frames; frame += 1) {
        for (const channel of channels) mixSample(channel[frame] ?? 0);
      }
      frames += block.frames;
      return Promise.resolve();
    },
    fingerprint: () => (BigInt(high) << 32n) | BigInt(low),
    frames: () => frames,
  };
}
