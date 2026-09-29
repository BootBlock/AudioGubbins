import { describe, expect, it } from 'vitest';

import { StandardLayouts, sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { frameBlock } from '@audiogubbins/audio-engine';

import { fingerprintSink } from './fingerprint-sink.js';

const RATE = expectSuccess(sampleRate(48_000));

/**
 * FNV-1a-64 over every byte of `samples` written little-endian, one `bigint`
 * step per byte: the definition, written the slow way the golden tests write
 * it, over the whole buffer at once.
 */
function wholeBufferFingerprint(samples: readonly number[]): bigint {
  const bytes = new DataView(new ArrayBuffer(samples.length * 4));
  samples.forEach((sample, index) => {
    bytes.setFloat32(index * 4, sample, true);
  });
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    hash ^= BigInt(bytes.getUint8(index));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash;
}

/** A stereo tone-like signal whose channels differ, with values that exercise every byte. */
function channels(frames: number): readonly [Float32Array, Float32Array] {
  const left = Float32Array.from({ length: frames }, (_, frame) => Math.sin(frame * 0.0575) * 0.25);
  const right = Float32Array.from({ length: frames }, (_, frame) => -Math.cos(frame * 0.031) * 0.9);
  return [left, right];
}

/** Writes `left` and `right` to a new sink in chunks of `chunk` frames. */
async function fingerprintInChunks(
  left: Float32Array,
  right: Float32Array,
  chunk: number,
): Promise<{ readonly fingerprint: bigint; readonly frames: number }> {
  const sink = fingerprintSink();
  for (let start = 0; start < left.length; start += chunk) {
    const end = Math.min(left.length, start + chunk);
    await sink.write(
      expectSuccess(
        frameBlock(StandardLayouts.stereo, RATE, [
          left.subarray(start, end),
          right.subarray(start, end),
        ]),
      ),
    );
  }
  return { fingerprint: sink.fingerprint(), frames: sink.frames() };
}

describe('the fingerprinting render sink', () => {
  it('starts from the FNV-1a-64 offset basis, having been written nothing', () => {
    expect(fingerprintSink().fingerprint()).toBe(0xcbf29ce484222325n);
  });

  it('equals FNV-1a-64 of the whole render, its frames in order with the channels interleaved', async () => {
    const [left, right] = channels(10_007);
    const interleaved = [...left].flatMap((sample, frame) => [sample, right[frame] ?? 0]);

    const written = await fingerprintInChunks(left, right, 4_096);

    expect(written.frames).toBe(10_007);
    expect(written.fingerprint).toBe(wholeBufferFingerprint(interleaved));
  });

  it('gives the same fingerprint whatever chunks the render arrives in', async () => {
    const [left, right] = channels(3_001);
    const whole = await fingerprintInChunks(left, right, 3_001);

    for (const chunk of [1, 7, 128, 1_000]) {
      expect((await fingerprintInChunks(left, right, chunk)).fingerprint).toBe(whole.fingerprint);
    }
  });

  it('tells a channel swap apart, which a sum of the samples would not', async () => {
    const [left, right] = channels(512);

    const straight = await fingerprintInChunks(left, right, 512);
    const swapped = await fingerprintInChunks(right, left, 512);

    expect(swapped.fingerprint).not.toBe(straight.fingerprint);
  });
});
