import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { memorySource } from '@audiogubbins/media-store/testing';
import { CONTENT_CHUNK_BYTES, contentIdOf } from '@audiogubbins/project-format';

import { HashingSink } from './hashing-sink.js';
import { memorySink } from './testing/memory-ports.js';
import { nodeDigest } from './testing/node-services.js';

/** Bytes that differ from place to place, across more than one chunk. */
function bytes(length: number): Uint8Array<ArrayBuffer> {
  return Uint8Array.from({ length }, (_, index) => (index * 31 + 7) % 251);
}

describe('a sink that identifies what it writes (REQ-STOR-197)', () => {
  it('writes every byte through and knows their identity once it closes, however they arrived', async () => {
    const whole = bytes(CONTENT_CHUNK_BYTES + 5_000);
    const inner = memorySink();
    const sink = new HashingSink(inner, nodeDigest);

    // In pieces that straddle a chunk's end, one of them a view into shared memory.
    await sink.write(whole.subarray(0, 700_000));
    const shared = new Uint8Array(new SharedArrayBuffer(whole.length - 700_000));
    shared.set(whole.subarray(700_000));
    await sink.write(shared);
    await sink.close();

    expect(inner.ending).toBe('closed');
    expect(inner.bytes()).toEqual(whole);
    expect(sink.identity).toEqual(
      expectSuccess(await contentIdOf(memorySource(whole), nodeDigest)),
    );
  });

  it('knows nothing before it closes, and passes an abort through', async () => {
    const inner = memorySink();
    const sink = new HashingSink(inner, nodeDigest);
    await sink.write(bytes(10));

    expect(() => sink.identity).toThrow(/only once it has closed/);
    await sink.abort(new Error('Given up.'));
    expect(inner.ending).toBe('aborted');
    expect(() => sink.identity).toThrow(/only once it has closed/);
  });
});
