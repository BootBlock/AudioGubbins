import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import type { ByteSource } from '@audiogubbins/project-format';

import { sampleSource } from './source-sampling.js';
import { generatedBytes, generatedSource, memorySource } from './testing/index.js';
import { nodeDigest } from './testing/node-digest.js';

const KIB = 1_024;

/**
 * The fast fingerprint by its definition, computed here without the module:
 * the length in 8 big-endian bytes, then the whole file up to 192 KiB, or its
 * first, centred and last 64 KiB.
 */
function referenceFingerprint(bytes: Uint8Array): string {
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  const hash = createHash('sha256').update(length);
  if (bytes.length <= 192 * KIB) return hash.update(bytes).digest('hex');
  const middle = Math.floor((bytes.length - 64 * KIB) / 2);
  return hash
    .update(bytes.subarray(0, 64 * KIB))
    .update(bytes.subarray(middle, middle + 64 * KIB))
    .update(bytes.subarray(bytes.length - 64 * KIB))
    .digest('hex');
}

describe('the quick signals of a file', () => {
  it('fingerprints the length and the sampled ranges, whole up to 192 KiB', async () => {
    for (const size of [0, 1, 15, 16, 17, 192 * KIB, 192 * KIB + 1, 1_000_003]) {
      const bytes = generatedBytes(0, size, size);

      const sample = expectSuccess(await sampleSource(memorySource(bytes), nodeDigest));

      expect(sample.fastFingerprint, `size ${String(size)}`).toBe(referenceFingerprint(bytes));
      expect(sample.signature).toBe(Buffer.from(bytes.subarray(0, 16)).toString('hex'));
    }
  });

  it('reads at most 192 KiB of a file of any size', async () => {
    const source = generatedSource(3_000_000_000, 1);

    expectSuccess(await sampleSource(source, nodeDigest));

    expect(source.bytesRead).toBe(192 * KIB);
  });

  it('tells apart two files of one length that differ only in a sampled range', async () => {
    const bytes = generatedBytes(0, 1_000_000, 2);
    const changed = bytes.slice();
    changed[500_000] = (changed[500_000] ?? 0) ^ 0xff;

    const one = expectSuccess(await sampleSource(memorySource(bytes), nodeDigest));
    const other = expectSuccess(await sampleSource(memorySource(changed), nodeDigest));

    expect(one.fastFingerprint).not.toBe(other.fastFingerprint);
    expect(one.signature).toBe(other.signature);
  });

  it('reports a file that shrinks while it is sampled', async () => {
    const shrunk: ByteSource = {
      size: 1_000_000,
      read: (offset, length) => Promise.resolve(generatedBytes(offset, length - 1, 3)),
    };

    expect(expectFailureCode(await sampleSource(shrunk, nodeDigest))).toBe('media.source-changed');
  });

  it('stops when aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('stopped'));

    await expect(
      sampleSource(generatedSource(1_000_000, 4), nodeDigest, controller.signal),
    ).rejects.toThrow('stopped');
  });
});
