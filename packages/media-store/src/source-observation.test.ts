import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { CONTENT_CHUNK_BYTES, contentIdOf, type ByteSource } from '@audiogubbins/project-format';

import type { ExternalFile } from './external-file.js';
import { hashProgressively } from './progressive-hashing.js';
import { completeIdentity, observeFile } from './source-observation.js';
import { sampleSource } from './source-sampling.js';
import { generatedBytes, generatedSource, memorySource, nodeDigest } from './testing/index.js';

const SIZE = 3 * CONTENT_CHUNK_BYTES + 99;

function fileOf(source: ByteSource, extra: Partial<ExternalFile> = {}): ExternalFile {
  return {
    source,
    fileName: 'Forest ambience.flac',
    mediaType: 'audio/flac',
    lastModified: 1_780_000_000_000,
    ...extra,
  };
}

const immediately = (): Promise<void> => Promise.resolve();

describe('hashing in the background', () => {
  it('gives the content identity, yielding to the host after every chunk', async () => {
    const events: string[] = [];

    const hashed = expectSuccess(
      await hashProgressively(
        generatedSource(SIZE, 1),
        nodeDigest,
        () => {
          events.push('yield');
          return Promise.resolve();
        },
        { onProgress: (done) => events.push(String(done)) },
      ),
    );

    expect(hashed).toEqual(expectSuccess(await contentIdOf(generatedSource(SIZE, 1), nodeDigest)));
    expect(events.filter((event) => event === 'yield')).toHaveLength(4);
    expect(events.at(-1)).toBe(String(SIZE));
  });

  it('stops when aborted between chunks', async () => {
    const controller = new AbortController();
    let chunks = 0;

    const hashing = hashProgressively(
      generatedSource(SIZE, 1),
      nodeDigest,
      () => {
        chunks += 1;
        if (chunks === 2) controller.abort(new Error('stopped'));
        return Promise.resolve();
      },
      { signal: controller.signal },
    );

    await expect(hashing).rejects.toThrow('stopped');
    expect(chunks).toBe(2);
  });
});

describe('taking the identity of an external file', () => {
  it('records every quick signal and what the file says of itself, without its content identity', async () => {
    const bytes = generatedBytes(0, 300_000, 2);
    const file = fileOf(memorySource(bytes), {
      handleKey: 'handle-0001',
      relativePath: 'Ambience/Forest ambience.flac',
      mediaType: 'Audio/FLAC; rate=48000',
    });

    const identity = expectSuccess(await observeFile(file, nodeDigest));

    const sample = expectSuccess(await sampleSource(memorySource(bytes), nodeDigest));
    expect(identity).toEqual({
      handleKey: 'handle-0001',
      fileName: 'Forest ambience.flac',
      relativePath: 'Ambience/Forest ambience.flac',
      byteLength: 300_000,
      lastModified: 1_780_000_000_000,
      mediaType: 'audio/flac',
      signature: sample.signature,
      fastFingerprint: sample.fastFingerprint,
    });
  });

  it('refuses a file whose name could not be recorded, before reading it', async () => {
    const source = generatedSource(1_000, 1);

    const refused = await observeFile(fileOf(source, { fileName: 'a/b.wav' }), nodeDigest);

    expect(expectFailureCode(refused)).toBe('media.file-name-malformed');
    expect(source.bytesRead).toBe(0);
  });

  it('completes an identity with the content identity of the same file', async () => {
    const identity = expectSuccess(await observeFile(fileOf(generatedSource(SIZE, 5)), nodeDigest));

    const completed = expectSuccess(
      await completeIdentity(identity, generatedSource(SIZE, 5), {
        digest: nodeDigest,
        yieldToHost: immediately,
      }),
    );

    const { contentId } = expectSuccess(await contentIdOf(generatedSource(SIZE, 5), nodeDigest));
    expect(completed).toEqual({ ...identity, contentId });
  });

  it('refuses to complete an identity from another version of the file', async () => {
    const identity = expectSuccess(await observeFile(fileOf(generatedSource(SIZE, 5)), nodeDigest));
    const services = { digest: nodeDigest, yieldToHost: immediately };

    const longer = await completeIdentity(identity, generatedSource(SIZE + 1, 5), services);
    const edited = await completeIdentity(identity, generatedSource(SIZE, 6), services);

    expect(expectFailureCode(longer)).toBe('media.source-changed');
    expect(expectFailureCode(edited)).toBe('media.source-changed');
  });

  it('refuses to complete an identity when the file changes while it is hashed', async () => {
    const identity = expectSuccess(await observeFile(fileOf(generatedSource(SIZE, 5)), nodeDigest));
    const edited = Math.floor(SIZE / 2);
    let reads = 0;
    const changing: ByteSource = {
      size: SIZE,
      read: (offset, length) => {
        reads += 1;
        const bytes = generatedBytes(offset, length, 5);
        // The hashing reads four chunks; the sampling after it sees one byte of
        // the middle edited, which leaves the signature as it was.
        if (reads > 4 && edited >= offset && edited < offset + length) {
          bytes[edited - offset] = (bytes[edited - offset] ?? 0) ^ 1;
        }
        return Promise.resolve(bytes);
      },
    };

    const refused = await completeIdentity(identity, changing, {
      digest: nodeDigest,
      yieldToHost: immediately,
    });

    expect(expectFailureCode(refused)).toBe('media.source-changed');
  });
});
