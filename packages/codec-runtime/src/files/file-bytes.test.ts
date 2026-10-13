import { createCancellationSource } from '@audiogubbins/domain';
import { describe, expect, it } from 'vitest';

import { codecModule } from '../testing/codec-module.js';
import { flacFile } from '../testing/encoded-fixtures.js';
import { MEMORY_READER, memoryFile } from '../testing/worker-harness.js';
import { SourceUnreadable, asyncAudioBytes } from './async-file-bytes.js';
import { openFileSource } from './file-source.js';
import {
  accessHandleSyncBytes,
  blobSyncBytes,
  type SyncAccessHandleLike,
} from './sync-file-bytes.js';

const BYTES = Uint8Array.from({ length: 1_000 }, (_, index) => index & 0xff);

/** A sync access handle over `bytes`, which records how it was used. */
function accessHandle(
  bytes: Uint8Array,
  log: { closed: number; reads: number[] } = { closed: 0, reads: [] },
) {
  const handle: SyncAccessHandleLike = {
    getSize: () => bytes.length,
    read: (buffer, { at }) => {
      log.reads.push(at);
      const available = bytes.subarray(at, at + buffer.length);
      buffer.set(available);
      return available.length;
    },
    close: () => {
      log.closed += 1;
    },
  };
  return { handle, log };
}

describe('a file read synchronously in the codec worker', () => {
  it('reads a chosen file a slice at a time, short only at its end', () => {
    const bytes = blobSyncBytes(memoryFile(BYTES), MEMORY_READER);
    expect(bytes.size).toBe(1_000);
    const into = new Uint8Array(300);
    expect(bytes.readInto(100, into)).toBe(300);
    expect(into).toEqual(BYTES.subarray(100, 400));
    expect(bytes.readInto(900, into)).toBe(100);
    expect(into.subarray(0, 100)).toEqual(BYTES.subarray(900));
    expect(bytes.readInto(1_000, into)).toBe(0);
  });

  it('reads an origin-private file through its handle into the caller’s buffer', () => {
    const { handle, log } = accessHandle(BYTES);
    const bytes = accessHandleSyncBytes(handle);
    const into = new Uint8Array(50);
    expect(bytes.readInto(975, into)).toBe(25);
    expect(into.subarray(0, 25)).toEqual(BYTES.subarray(975));
    expect(log.reads).toEqual([975]);
  });

  it('answers a file cut short under it as having changed, through the codec module', async () => {
    const module = await codecModule();
    const tone = Int32Array.from({ length: 50_000 }, (_, frame) => (frame * 37) % 30_000);
    const file = flacFile(module, [tone], {
      sampleRate: 48_000,
      bitsPerSample: 16,
      blockSize: 4_096,
    });
    // The handle states the file's size when opened; its reads find it cut in half.
    const { handle } = accessHandle(file.subarray(0, file.length >> 1));
    const bytes = accessHandleSyncBytes({ ...handle, getSize: () => file.length });
    const opened = module.openDecoder(bytes);
    const failed = opened.ok ? opened.value.decode([new Float32Array(60_000)]) : opened;
    expect(failed.ok ? undefined : failed.failures[0].code).toBe('codec-runtime.source-changed');
    if (opened.ok) opened.value.release();
  });

  it('offers the same reads to the asynchronous readers, a throwing read as unreadable', async () => {
    const signal = createCancellationSource().signal;
    const bytes = asyncAudioBytes(blobSyncBytes(memoryFile(BYTES), MEMORY_READER));
    expect(await bytes.read(10, 5, signal)).toEqual(BYTES.subarray(10, 15));
    expect((await bytes.read(990, 50, signal)).length).toBe(10);
    const throwing = asyncAudioBytes({
      size: 10,
      readInto: () => {
        throw new DOMException('The file was removed at C:\\Users\\someone.', 'NotFoundError');
      },
    });
    const rejected = await throwing.read(0, 4, signal).catch((error: unknown) => error);
    expect(rejected).toBeInstanceOf(SourceUnreadable);
    expect(rejected instanceof SourceUnreadable ? rejected.thrown : undefined).toBe(
      'NotFoundError',
    );
    expect(rejected instanceof Error ? rejected.message : '').not.toContain('Users');
    const cancellation = createCancellationSource();
    cancellation.cancel();
    await expect(bytes.read(0, 1, cancellation.signal)).rejects.toThrow();
  });

  it('opens an origin-private file read-only, closes it once, and says why one cannot be opened', async () => {
    const { handle, log } = accessHandle(BYTES);
    const modes: string[] = [];
    const opened = await openFileSource(
      {
        kind: 'origin-private',
        handle: {
          createSyncAccessHandle: (options) => {
            modes.push(options.mode);
            return Promise.resolve(handle);
          },
        },
      },
      MEMORY_READER,
    );
    if (!opened.ok) throw new Error(opened.failures[0].summary);
    expect(modes).toEqual(['read-only']);
    expect(opened.value.bytes.size).toBe(1_000);
    opened.value.close();
    opened.value.close();
    expect(log.closed).toBe(1);
    const locked = await openFileSource(
      {
        kind: 'origin-private',
        handle: {
          createSyncAccessHandle: () =>
            Promise.reject(new DOMException('Locked.', 'NoModificationAllowedError')),
        },
      },
      MEMORY_READER,
    );
    expect(locked.ok ? undefined : locked.failures[0]).toMatchObject({
      code: 'codec-runtime.unreadable',
      details: { cause: 'NoModificationAllowedError' },
    });
  });
});
