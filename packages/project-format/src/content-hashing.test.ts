import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import type { ByteSource, Digest } from './byte-ports.js';
import { canonicalJson } from './canonical-json.js';
import {
  CONTENT_CHUNK_BYTES,
  contentIdOf,
  createContentHasher,
  fingerprintOf,
} from './content-hashing.js';
import { nodeDigest } from './testing/node-digest.js';
import { seededRandom } from './testing/random-values.js';

const MIB = 1_048_576;

function sha256(...parts: readonly Uint8Array[]): Buffer {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest();
}

/**
 * The content identifier by the format's definition, computed here without the
 * package: the length in 8 big-endian bytes, then each 1 MiB chunk's digest,
 * all digested.
 */
function referenceContentId(bytes: Uint8Array): string {
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  const chunkDigests: Buffer[] = [];
  for (let offset = 0; offset < bytes.length; offset += MIB) {
    chunkDigests.push(sha256(bytes.subarray(offset, offset + MIB)));
  }
  return `c1-${sha256(length, ...chunkDigests).toString('hex')}`;
}

/** Deterministic bytes of the given length. */
function bytesOf(length: number, seed = 1): Uint8Array<ArrayBuffer> {
  const random = seededRandom(seed);
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) bytes[index] = random.below(256);
  return bytes;
}

/** A source over bytes in memory that counts the bytes it hands out. */
function sourceOf(bytes: Uint8Array<ArrayBuffer>): ByteSource & { readonly reads: number[] } {
  const reads: number[] = [];
  return {
    size: bytes.length,
    reads,
    read: (offset, length) => {
      reads.push(length);
      return Promise.resolve(bytes.slice(offset, offset + length));
    },
  };
}

describe('contentIdOf', () => {
  it.each([
    ['no bytes', 0],
    ['one byte', 1],
    ['one byte short of a chunk', MIB - 1],
    ['exactly one chunk', MIB],
    ['one byte past a chunk', MIB + 1],
    ['two and a half chunks', MIB * 2 + MIB / 2],
    ['exactly three chunks', MIB * 3],
  ])('matches the definition for %s', async (_case, length) => {
    const bytes = bytesOf(length, length + 1);
    const identity = expectSuccess(await contentIdOf(sourceOf(bytes), nodeDigest));
    expect(identity).toEqual({ contentId: referenceContentId(bytes), byteLength: length });
  });

  it('identifies no bytes by the digest of the eight length bytes alone', async () => {
    const identity = expectSuccess(await contentIdOf(sourceOf(new Uint8Array()), nodeDigest));
    expect(identity.contentId).toBe(`c1-${sha256(new Uint8Array(8)).toString('hex')}`);
  });

  it('fixes the chunk size at 1 MiB, which is part of the format', () => {
    expect(CONTENT_CHUNK_BYTES).toBe(MIB);
  });

  it('reads the source one chunk at a time, never whole', async () => {
    const source = sourceOf(bytesOf(MIB * 2 + 10));
    await contentIdOf(source, nodeDigest);
    expect(source.reads).toEqual([MIB, MIB, 10]);
  });

  it('tells two contents apart that differ in one byte or in length', async () => {
    const bytes = bytesOf(MIB + 5);
    const changed = bytes.slice();
    changed[MIB + 2] = (changed[MIB + 2] ?? 0) ^ 1;
    const [first, second, shorter] = await Promise.all(
      [bytes, changed, bytes.slice(0, MIB)].map(
        async (each) => await contentIdOf(sourceOf(each), nodeDigest),
      ),
    );
    const ids = [first, second, shorter].map((result) =>
      result?.ok === true ? result.value.contentId : '',
    );
    expect(new Set(ids).size).toBe(3);
  });

  it('reports progress after each chunk', async () => {
    const onProgress = vi.fn();
    await contentIdOf(sourceOf(bytesOf(MIB * 2 + 1)), nodeDigest, { onProgress });
    expect(onProgress.mock.calls).toEqual([
      [MIB, MIB * 2 + 1],
      [MIB * 2, MIB * 2 + 1],
      [MIB * 2 + 1, MIB * 2 + 1],
    ]);
  });

  it('refuses a source that returns other than the bytes asked for', async () => {
    const bytes = bytesOf(MIB + 100);
    const shrinking: ByteSource = {
      size: bytes.length,
      read: (offset, length) => Promise.resolve(bytes.slice(offset, offset + Math.min(length, 50))),
    };
    const result = await contentIdOf(shrinking, nodeDigest);
    expect(expectFailureCode(result)).toBe('content-id.short-read');
    expect(result.ok ? undefined : result.failures[0].details).toEqual({
      offset: 0,
      expected: MIB,
      received: 50,
    });
  });

  it('rejects with the signal’s reason when aborted between chunks, and reads no further', async () => {
    const controller = new AbortController();
    const bytes = bytesOf(MIB * 3);
    const reads: number[] = [];
    const source: ByteSource = {
      size: bytes.length,
      read: (offset, length) => {
        reads.push(offset);
        if (offset === MIB) controller.abort(new Error('stopped by the user'));
        return Promise.resolve(bytes.slice(offset, offset + length));
      },
    };
    await expect(contentIdOf(source, nodeDigest, { signal: controller.signal })).rejects.toThrow(
      'stopped by the user',
    );
    expect(reads).toEqual([0, MIB]);
  });

  it('passes the signal to every read, so a read in flight can stop too', async () => {
    const controller = new AbortController();
    const signals: (AbortSignal | undefined)[] = [];
    const bytes = bytesOf(MIB + 1);
    const source: ByteSource = {
      size: bytes.length,
      read: (offset, length, signal) => {
        signals.push(signal);
        return Promise.resolve(bytes.slice(offset, offset + length));
      },
    };
    await contentIdOf(source, nodeDigest, { signal: controller.signal });
    expect(signals).toEqual([controller.signal, controller.signal]);
  });

  it('throws on a source whose size is not a whole number of bytes', async () => {
    const source: ByteSource = { size: 1.5, read: () => Promise.resolve(new Uint8Array()) };
    await expect(contentIdOf(source, nodeDigest)).rejects.toThrow(RangeError);
  });

  it('throws on a digest port that does not return 32 bytes', async () => {
    const short: Digest = () => Promise.resolve(new Uint8Array(20));
    await expect(contentIdOf(sourceOf(bytesOf(3)), short)).rejects.toThrow('SHA-256 produces 32');
  });
});

describe('createContentHasher', () => {
  it('gives the same identity however the bytes are split', async () => {
    const bytes = bytesOf(MIB * 2 + 777, 5);
    const expected = referenceContentId(bytes);
    const random = seededRandom(9);

    for (let trial = 0; trial < 12; trial += 1) {
      const hasher = createContentHasher(nodeDigest);
      let offset = 0;
      while (offset < bytes.length) {
        // Pieces from empty to past a chunk, so boundaries fall everywhere.
        const size = random.pick([0, 1, 7, 4_096, MIB - 1, MIB, MIB + 3]);
        await hasher.update(bytes.slice(offset, offset + size));
        offset += size;
      }
      expect(await hasher.finish()).toEqual({ contentId: expected, byteLength: bytes.length });
    }
  });

  it('agrees with contentIdOf for the same bytes', async () => {
    const bytes = bytesOf(MIB + 1, 3);
    const hasher = createContentHasher(nodeDigest);
    await hasher.update(bytes);
    expect(await hasher.finish()).toEqual(
      expectSuccess(await contentIdOf(sourceOf(bytes), nodeDigest)),
    );
  });

  it('digests a whole chunk arriving at a chunk boundary where it lies, without copying it', async () => {
    const bytes = bytesOf(MIB * 2 + 5, 6);
    const buffers: ArrayBufferLike[] = [];
    const spying: Digest = async (input) => {
      buffers.push(input.buffer);
      return await nodeDigest(input);
    };
    const hasher = createContentHasher(spying);
    await hasher.update(bytes);
    expect((await hasher.finish()).contentId).toBe(referenceContentId(bytes));
    expect(buffers.map((buffer) => buffer === bytes.buffer)).toEqual([true, true, false, false]);
  });

  it('copies what it keeps, so the caller may reuse its buffer', async () => {
    const bytes = bytesOf(10, 4);
    const hasher = createContentHasher(nodeDigest);
    const buffer = bytes.slice();
    await hasher.update(buffer);
    buffer.fill(0);
    expect((await hasher.finish()).contentId).toBe(referenceContentId(bytes));
  });

  it('refuses a second call while one is running, and any call after finishing', async () => {
    const hasher = createContentHasher(nodeDigest);
    const first = hasher.update(bytesOf(MIB));
    await expect(hasher.update(bytesOf(1))).rejects.toThrow('while it is busy');
    await first;
    await hasher.finish();
    await expect(hasher.update(bytesOf(1))).rejects.toThrow('while it is finished');
    await expect(hasher.finish()).rejects.toThrow('while it is finished');
  });

  it('stays failed after a digest rejects, since a chunk may be half taken', async () => {
    const failing: Digest = () => Promise.reject(new Error('digest unavailable'));
    const hasher = createContentHasher(failing);
    await expect(hasher.update(bytesOf(MIB))).rejects.toThrow('digest unavailable');
    await expect(hasher.update(bytesOf(1))).rejects.toThrow('while it is failed');
  });
});

describe('fingerprintOf', () => {
  it('is the SHA-256 of the canonical text in UTF-8, prefixed s1-', async () => {
    const text = canonicalJson({ name: 'Wâlk 🎵', b: 1, a: [true, null] });
    expect(await fingerprintOf(text, nodeDigest)).toBe(
      `s1-${sha256(Buffer.from(text, 'utf8')).toString('hex')}`,
    );
  });

  it('is the same for equal values built in any order', async () => {
    const one = await fingerprintOf(canonicalJson({ a: 1, b: [2, 3] }), nodeDigest);
    const other = await fingerprintOf(canonicalJson({ b: [2, 3], a: 1 }), nodeDigest);
    expect(one).toBe(other);
  });
});
