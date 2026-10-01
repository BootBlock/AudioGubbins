import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import { TreeFailure, TreeFailureKind } from '@audiogubbins/project-format';
import { describe, expect, it } from 'vitest';

import type { SyncDirectory, SyncFileEntry } from './sync-file-system.js';
import { SyncStorageTree, originPrivateTree } from './sync-storage-tree.js';
import { MemorySyncFileSystem, type MemorySyncOptions } from './testing/memory-sync-file-system.js';
import { bytes, scenario } from './testing/tree-scenario.js';

/** A tree over a file system held in memory, and that file system. */
function treeOver(options: MemorySyncOptions = {}): {
  readonly tree: SyncStorageTree;
  readonly system: MemorySyncFileSystem;
} {
  const system = new MemorySyncFileSystem(options);
  return { tree: new SyncStorageTree(() => Promise.resolve(system.root())), system };
}

/** A file entry whose every open file writes one byte fewer than it is given. */
function shortWritingFile(entry: SyncFileEntry): SyncFileEntry {
  return {
    snapshot: () => entry.snapshot(),
    open: async () => {
      const file = await entry.open();
      return {
        write: async (given, at) => await file.write(given.subarray(0, given.length - 1), at),
        truncate: (size) => file.truncate(size),
        flush: () => file.flush(),
        close: () => file.close(),
      };
    },
  };
}

/** A directory whose files, at any depth, write short. */
function shortWriting(directory: SyncDirectory): SyncDirectory {
  return {
    directory: async (name, create) => shortWriting(await directory.directory(name, create)),
    file: async (name, create) => shortWritingFile(await directory.file(name, create)),
    remove: (name) => directory.remove(name),
    entries: () => directory.entries(),
  };
}

describe('the tree run against the file-system port', () => {
  it('does everything the port promises, as the in-memory reference tree does', async () => {
    const reference = await scenario(new MemoryStorageTree());
    const { tree, system } = treeOver();

    expect(await scenario(tree)).toEqual(reference);
    // The scenario ends having removed the root's every entry.
    expect(system.files()).toEqual(new Map());
  });

  it('refuses a write past the quota, before losing any byte of the file it would replace', async () => {
    const { tree } = treeOver({ quotaBytes: 4 });
    await tree.writeFile('f.bin', bytes(1, 2, 3));
    await expect(tree.writeFile('f.bin', bytes(1, 2, 3, 4, 5, 6))).rejects.toMatchObject({
      kind: TreeFailureKind.Quota,
    });
    expect(await tree.readFile('f.bin')).toEqual(bytes(1, 2, 3));

    const sink = await tree.createFile('g.bin');
    await expect(sink.write(bytes(1, 2))).rejects.toMatchObject({ kind: TreeFailureKind.Quota });
  });

  it('can leave a write that fails after sizing its file torn at its full length', async () => {
    const { tree, system } = treeOver({
      refuse: (asked) =>
        asked === 'write' ? new DOMException('Lost.', 'UnknownError') : undefined,
    });
    await expect(tree.writeFile('f.bin', bytes(1, 2, 3))).rejects.toBeInstanceOf(TreeFailure);
    expect(system.files().get('f.bin')).toEqual(bytes(0, 0, 0));
  });

  it('removes what an abandoned sink wrote, leaving no partial file', async () => {
    const { tree, system } = treeOver();
    await tree.writeFile('keep.bin', bytes(1));

    const sink = await tree.createFile('media/partial.bin');
    await sink.write(bytes(1, 2, 3));
    expect(system.files().get('media/partial.bin')).toEqual(bytes(1, 2, 3));
    await sink.abort(new Error('The import was cancelled.'));

    expect([...system.files().keys()]).toEqual(['keep.bin']);
    expect(await tree.list('media')).toEqual([]);
    // The abandoned file's path is free again.
    await tree.writeFile('media/partial.bin', bytes(4));
    expect(await tree.readFile('media/partial.bin')).toEqual(bytes(4));
  });

  it('leaves the caller its own bytes, neither given up nor kept', async () => {
    const { tree } = treeOver();
    const written = bytes(1, 2, 3);
    await tree.writeFile('f.bin', written);
    const sink = await tree.createFile('g.bin');
    const chunk = bytes(4, 5);
    await sink.write(chunk);
    await sink.close();

    expect(written).toEqual(bytes(1, 2, 3));
    expect(chunk).toEqual(bytes(4, 5));
    written.fill(0);
    chunk.fill(0);
    expect(await tree.readFile('f.bin')).toEqual(bytes(1, 2, 3));
    expect(await tree.readFile('g.bin')).toEqual(bytes(4, 5));
  });

  it('orders changes to one file, whose access handle is exclusive, and lands them as given', async () => {
    const { tree, system } = treeOver();

    await Promise.all(
      [1, 2, 3, 4, 5].map((value) => tree.writeFile('one/file.bin', bytes(value, value))),
    );
    expect(system.files().get('one/file.bin')).toEqual(bytes(5, 5));

    // A directory's removal waits for a file open inside it.
    const sink = await tree.createFile('one/open.bin');
    const removal = tree.remove('one');
    const replaced = tree.writeFile('one/open.bin', bytes(9));
    await sink.write(bytes(1));
    await sink.close();
    await removal;
    await replaced;
    expect([...system.files()]).toEqual([['one/open.bin', bytes(9)]]);
  });

  it('writes the chunks of a sink in the order they were given, however they are awaited', async () => {
    const { tree, system } = treeOver();
    const sink = await tree.createFile('f.bin');
    await Promise.all([
      sink.write(bytes(1)),
      sink.write(bytes(2, 3)),
      sink.write(bytes(4)),
      sink.close(),
    ]);
    expect(system.files().get('f.bin')).toEqual(bytes(1, 2, 3, 4));
  });

  it('reads while a file is being written, since a read takes no access handle', async () => {
    const { tree } = treeOver();
    const sink = await tree.createFile('f.bin');
    await sink.write(bytes(1));
    expect(await tree.readFile('f.bin')).toEqual(bytes(1));
    await sink.close();
  });

  it('reads each range of an open file from the file as it is then', async () => {
    const { tree } = treeOver();
    await tree.writeFile('f.bin', bytes(1, 2, 3, 4));
    const source = await tree.openFile('f.bin');
    await tree.writeFile('f.bin', bytes(5, 6));

    expect(source?.size).toBe(4);
    expect(await source?.read(0, 4)).toEqual(bytes(5, 6));
    await expect(source?.read(-1, 2)).rejects.toBeInstanceOf(RangeError);
  });
});

describe('the platform refusals the tree reports', () => {
  const refusing = (refused: DOMException, operation: string): MemorySyncOptions => ({
    refuse: (asked) => (asked === operation ? refused : undefined),
  });

  it.each([
    ['QuotaExceededError', TreeFailureKind.Quota],
    ['SecurityError', TreeFailureKind.Unavailable],
    ['InvalidStateError', TreeFailureKind.Unavailable],
    ['NoModificationAllowedError', TreeFailureKind.Io],
    ['UnknownError', TreeFailureKind.Io],
  ])('reports %s as %s, with the platform error itself as the cause', async (name, kind) => {
    const refused = new DOMException('Refused.', name);
    const { tree } = treeOver(refusing(refused, 'write'));

    const failure = await tree.writeFile('f.bin', bytes(1)).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TreeFailure);
    expect(failure).toMatchObject({ kind, cause: refused });

    const sink = await tree.createFile('g.bin');
    await expect(sink.write(bytes(1))).rejects.toMatchObject({ kind, cause: refused });
  });

  it('reports a refused listing or removal as a failure, not as nothing there', async () => {
    const refused = new DOMException('Refused.', 'UnknownError');
    const { tree } = treeOver({
      refuse: (asked) => (asked === 'directory' || asked === 'remove' ? refused : undefined),
    });
    await expect(tree.list('a')).rejects.toMatchObject({ kind: TreeFailureKind.Io });
    await expect(tree.remove('a')).rejects.toMatchObject({ kind: TreeFailureKind.Io });
  });

  it('refuses a write the file system took only part of', async () => {
    const system = new MemorySyncFileSystem();
    const tree = new SyncStorageTree(() => Promise.resolve(shortWriting(system.root())));

    await expect(tree.writeFile('a/f.bin', bytes(1, 2, 3))).rejects.toMatchObject({
      kind: TreeFailureKind.Io,
      cause: { name: 'UnknownError' },
    });
    const sink = await tree.createFile('a/g.bin');
    await expect(sink.write(bytes(1, 2))).rejects.toMatchObject({ kind: TreeFailureKind.Io });
    // The next chunk is written where the short one ended.
    await expect(sink.write(bytes(3, 4))).rejects.toMatchObject({ kind: TreeFailureKind.Io });
    await sink.close();
    expect(system.files().get('a/g.bin')).toEqual(bytes(1, 3));
  });

  it('reads a file that is not there as absent, not as a failure', async () => {
    const { tree } = treeOver(refusing(new DOMException('Gone.', 'NotFoundError'), 'snapshot'));
    await tree.writeFile('f.bin', bytes(1));

    expect(await tree.readFile('f.bin')).toBeUndefined();
    expect(await tree.openFile('f.bin')).toBeUndefined();
  });

  it('asks for the root once, when first needed, and keeps its refusal for every operation', async () => {
    let asked = 0;
    const tree = new SyncStorageTree(() => {
      asked += 1;
      return Promise.reject(new DOMException('Private browsing.', 'SecurityError'));
    });
    expect(asked).toBe(0);

    await expect(tree.readFile('f.bin')).rejects.toMatchObject({
      kind: TreeFailureKind.Unavailable,
    });
    await expect(tree.list('')).rejects.toMatchObject({ kind: TreeFailureKind.Unavailable });
    await expect(tree.createFile('f.bin')).rejects.toMatchObject({
      kind: TreeFailureKind.Unavailable,
    });
    expect(asked).toBe(1);
  });

  it('reports a worker offered no private storage as unavailable', async () => {
    const tree = originPrivateTree(undefined);
    await expect(tree.writeFile('f.bin', bytes(1))).rejects.toMatchObject({
      kind: TreeFailureKind.Unavailable,
      cause: { name: 'NotSupportedError' },
    });
  });
});

describe('the paths the tree holds', () => {
  it('refuses a path no tree can hold where it is called, touching nothing', async () => {
    let asked = 0;
    const tree = new SyncStorageTree(() => {
      asked += 1;
      return Promise.resolve(new MemorySyncFileSystem().root());
    });
    await expect(tree.readFile('A.bin')).rejects.toThrow(/Not a tree path/);
    await expect(tree.list('a/../b')).rejects.toThrow(/Not a tree path/);
    await expect(tree.createFile('')).rejects.toThrow(/root of the tree/);
    await expect(tree.writeFile('', bytes(1))).rejects.toThrow(/root of the tree/);
    expect(asked).toBe(0);
  });

  it('leaves out of a listing an entry the tree could not have written', async () => {
    const { tree, system } = treeOver();
    system.plant('Desktop.ini');
    await tree.writeFile('a.bin', bytes(1));
    expect(await tree.list('')).toEqual([{ name: 'a.bin', kind: 'file' }]);
  });
});

describe('abandoning an operation', () => {
  it('rejects with the reason at once, touching nothing, where the signal has already aborted', async () => {
    let asked = 0;
    const tree = new SyncStorageTree(() => {
      asked += 1;
      return Promise.resolve(new MemorySyncFileSystem().root());
    });
    const reason = new Error('No longer wanted.');
    await expect(tree.readFile('f.bin', AbortSignal.abort(reason))).rejects.toBe(reason);
    await expect(tree.writeFile('f.bin', bytes(1), AbortSignal.abort(reason))).rejects.toBe(reason);
    expect(asked).toBe(0);
  });

  it("rejects with the signal's own reason where it is a platform error", async () => {
    const { tree } = treeOver();
    await tree.writeFile('f.bin', bytes(1));
    // A reason that is a `DOMException`, as an abort's default one is, is the
    // caller's and no refusal of the storage, whether the read is under way or
    // the write is waiting its turn. Made here rather than left to the default,
    // which the test environment makes from another realm's `DOMException`.
    const reason = new DOMException('No longer wanted.', 'AbortError');
    const reader = new AbortController();
    const reading = tree.readFile('f.bin', reader.signal);
    reader.abort(reason);
    await expect(reading).rejects.toBe(reason);

    const sink = await tree.createFile('f.bin');
    const writer = new AbortController();
    const writing = tree.writeFile('f.bin', bytes(2), writer.signal);
    writer.abort(reason);
    await expect(writing).rejects.toBe(reason);
    await sink.close();
  });

  it('drops a change still waiting its turn', async () => {
    const { tree, system } = treeOver();
    const sink = await tree.createFile('f.bin');

    const controller = new AbortController();
    const reason = new Error('No longer wanted.');
    const waiting = tree.writeFile('f.bin', bytes(9), controller.signal);
    controller.abort(reason);
    await expect(waiting).rejects.toBe(reason);

    await sink.write(bytes(1));
    await sink.close();
    expect(system.files().get('f.bin')).toEqual(bytes(1));
  });
});
