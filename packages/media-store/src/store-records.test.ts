import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { contentIdFrom, decodeUtf8, encodeUtf8 } from '@audiogubbins/project-format';

import { intentBytes, readIntent, readSeal, sealBytes } from './store-records.js';
import { nodeDigest } from './testing/node-digest.js';

const id = expectSuccess(contentIdFrom(`c1-${'ab'.repeat(32)}`));

describe('the records beside stored objects', () => {
  it('reads back the seal and the intent it wrote', async () => {
    const seal = await sealBytes({ contentId: id, byteLength: 9_007_199_254_740_991 }, nodeDigest);
    const intent = await intentBytes(id, nodeDigest);

    expect(await readSeal(seal, nodeDigest)).toEqual({
      contentId: id,
      byteLength: 9_007_199_254_740_991,
    });
    expect(await readIntent(intent, nodeDigest)).toBe(id);
    expect(expectSuccess(decodeUtf8(seal))).toMatch(
      /^audiogubbins-media-seal 1 c1-(?:ab){32} 9007199254740991 [0-9a-f]{64}\n$/u,
    );
  });

  it('reads a torn record as none, at every length it could be torn to', async () => {
    const seal = await sealBytes({ contentId: id, byteLength: 1_234_567 }, nodeDigest);
    const intent = await intentBytes(id, nodeDigest);

    for (let length = 0; length < seal.length; length += 1) {
      expect(await readSeal(seal.subarray(0, length), nodeDigest)).toBeUndefined();
    }
    for (let length = 0; length < intent.length; length += 1) {
      expect(await readIntent(intent.subarray(0, length), nodeDigest)).toBeUndefined();
    }
  });

  it('reads a record whose check does not match its text as none', async () => {
    const text = expectSuccess(
      decodeUtf8(await sealBytes({ contentId: id, byteLength: 1_234_567 }, nodeDigest)),
    );
    const altered = text.replace(' 1234567 ', ' 1234568 ');

    expect(await readSeal(encodeUtf8(altered), nodeDigest)).toBeUndefined();
  });

  it('never reads one kind of record as the other', async () => {
    const seal = await sealBytes({ contentId: id, byteLength: 1 }, nodeDigest);

    expect(await readIntent(seal, nodeDigest)).toBeUndefined();
    expect(await readSeal(await intentBytes(id, nodeDigest), nodeDigest)).toBeUndefined();
  });
});
