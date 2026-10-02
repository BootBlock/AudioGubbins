import { TreeFailure, TreeFailureKind } from '@audiogubbins/project-format';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { BlobSink } from './blob-sink.js';
import {
  openFileSink,
  openFileSinkIn,
  type FileWriteStream,
  type WritableDirectory,
  type WritableFile,
} from './file-stream-sink.js';

/** A writable stream that records what reaches it, refusing writes as told. */
function recordingStream(refuseWrite?: DOMException): FileWriteStream & {
  readonly written: number[][];
  readonly ended: string[];
} {
  const written: number[][] = [];
  const ended: string[] = [];
  return {
    written,
    ended,
    write: (data) => {
      if (refuseWrite !== undefined) return Promise.reject(refuseWrite);
      written.push([...data]);
      return Promise.resolve();
    },
    close: () => {
      ended.push('close');
      return Promise.resolve();
    },
    abort: () => {
      ended.push('abort');
      return Promise.resolve();
    },
  };
}

describe('a sink over a file the user chose', () => {
  it("writes through the browser's own file and folder handles", () => {
    expectTypeOf<FileSystemFileHandle>().toExtend<WritableFile>();
    expectTypeOf<FileSystemDirectoryHandle>().toExtend<WritableDirectory>();
  });

  it('writes each chunk, and replaces the file only by closing, never keeping what was there', async () => {
    const stream = recordingStream();
    const opened: object[] = [];
    const sink = await openFileSink({
      createWritable: (options) => {
        opened.push(options);
        return Promise.resolve(stream);
      },
    });
    await sink.write(Uint8Array.from([1, 2]));
    await sink.write(Uint8Array.from([3]));
    await sink.close();

    expect(opened).toEqual([{ keepExistingData: false }]);
    expect(stream.written).toEqual([[1, 2], [3]]);
    expect(stream.ended).toEqual(['close']);
    await expect(sink.write(Uint8Array.from([4]))).rejects.toThrow(/closed or aborted/);
  });

  it('discards what was written when it aborts', async () => {
    const stream = recordingStream();
    const sink = await openFileSink({ createWritable: () => Promise.resolve(stream) });
    await sink.write(Uint8Array.from([1]));
    await sink.abort();
    expect(stream.ended).toEqual(['abort']);
  });

  it('opens the named file in a folder, making it', async () => {
    const stream = recordingStream();
    const asked: unknown[] = [];
    await openFileSinkIn(
      {
        getFileHandle: (name, options) => {
          asked.push([name, options]);
          return Promise.resolve({ createWritable: () => Promise.resolve(stream) });
        },
      },
      'project.agbundle',
    );
    expect(asked).toEqual([['project.agbundle', { create: true }]]);
  });

  it('reports a full disk as a quota failure, and a withdrawn permission as unavailable', async () => {
    const full = await openFileSink({
      createWritable: () =>
        Promise.resolve(recordingStream(new DOMException('Full.', 'QuotaExceededError'))),
    });
    const failure = await full.write(Uint8Array.from([1])).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TreeFailure);
    expect(failure).toMatchObject({ kind: TreeFailureKind.Quota });

    await expect(
      openFileSink({
        createWritable: () => Promise.reject(new DOMException('Withdrawn.', 'NotAllowedError')),
      }),
    ).rejects.toMatchObject({ kind: TreeFailureKind.Unavailable });
  });
});

describe('a sink for a download', () => {
  it('joins every chunk into one blob of its type once it closes', async () => {
    const sink = new BlobSink('application/zip');
    const chunk = Uint8Array.from([1, 2, 3]);
    await sink.write(chunk);
    // The caller may reuse its buffer at once.
    chunk.fill(9);
    await sink.write(Uint8Array.from([4]).subarray(0, 1));
    expect(() => sink.blob()).toThrow(/only once it closes/);
    await sink.close();

    const blob = sink.blob();
    expect(blob.type).toBe('application/zip');
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1, 2, 3, 4]);
  });

  it('holds nothing once aborted, and cannot be used after', async () => {
    const sink = new BlobSink('application/zip');
    await sink.write(Uint8Array.from([1]));
    await sink.abort();
    expect(() => sink.blob()).toThrow();
    await expect(sink.write(Uint8Array.from([2]))).rejects.toThrow(/closed or aborted/);
  });
});
