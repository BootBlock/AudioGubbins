import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { hexOf } from '@audiogubbins/project-format';

import { nobleSha256 } from './noble-sha256.js';

const encoder = new TextEncoder();

/** The hexadecimal digest of `chunks`, handed to the hash one after another. */
async function digestOf(chunks: readonly Uint8Array<ArrayBuffer>[]): Promise<string> {
  const run = nobleSha256();
  for (const chunk of chunks) await run.update(chunk);
  return hexOf(await run.digest());
}

/** A seeded generator of 32-bit words: Marsaglia's xorshift, so every run draws the same. */
function words(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
}

/**
 * `bytes` cut at random places into chunks of random lengths, with empty
 * chunks among them, some longer than the hash's 64-byte block and most not
 * a whole number of blocks, so every way a chunk can meet a block's edge
 * occurs.
 */
function randomChunks(
  bytes: Uint8Array<ArrayBuffer>,
  next: () => number,
): Uint8Array<ArrayBuffer>[] {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const draw = next() % 8;
    const length = draw === 0 ? 0 : draw < 5 ? next() % 70 : next() % 1_000;
    chunks.push(bytes.slice(offset, offset + length));
    offset += length;
  }
  chunks.push(new Uint8Array(0));
  return chunks;
}

describe('the streaming SHA-256 on @noble/hashes', () => {
  // The examples of FIPS 180-4 that NIST publishes for SHA-256.
  it.each([
    ['the empty message', '', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['"abc"', 'abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'the 448-bit message',
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
  ])('gives NIST’s digest of %s', async (_name, text, digest) => {
    expect(await digestOf([encoder.encode(text)])).toBe(digest);
  });

  it('gives NIST’s digest of a million "a"s, whole and in two uneven parts', async () => {
    const million = new Uint8Array(1_000_000).fill(0x61);
    const halves = [million.slice(0, 500_001), million.slice(500_001)];
    const digest = 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0';
    expect(await digestOf([million])).toBe(digest);
    expect(await digestOf(halves)).toBe(digest);
  });

  it('gives the digest of the whole however the bytes are cut into chunks', async () => {
    const next = words(0x5eed);
    for (let trial = 0; trial < 40; trial += 1) {
      const bytes = Uint8Array.from({ length: next() % 5_000 }, () => next() & 0xff);
      const expected = createHash('sha256').update(bytes).digest('hex');
      expect(await digestOf(randomChunks(bytes, next)), `trial ${String(trial)}`).toBe(expected);
    }
  });

  it('starts each run afresh, so one file’s bytes never reach another’s digest', async () => {
    const first = nobleSha256();
    const second = nobleSha256();
    await first.update(encoder.encode('ab'));
    await second.update(encoder.encode('abc'));
    await first.update(encoder.encode('c'));
    const abc = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    expect(hexOf(await first.digest())).toBe(abc);
    expect(hexOf(await second.digest())).toBe(abc);
  });
});
