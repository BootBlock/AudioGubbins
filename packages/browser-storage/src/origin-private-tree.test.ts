import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import { TreeFailure, TreeFailureKind } from '@audiogubbins/project-format';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { startOriginPrivateTree } from './origin-private-tree.js';
import { serveOriginPrivateTree, type TreeWorkerScope } from './serve-tree.js';
import { MemorySyncFileSystem, type MemorySyncOptions } from './testing/memory-sync-file-system.js';
import { bytes, scenario } from './testing/tree-scenario.js';
import { servedPair, workerPair } from './testing/worker-pair.js';
import type { TreeWorker } from './worker-channel.js';

describe('the tree over the origin-private file system', () => {
  it("is served by the browser's own worker and its global scope", () => {
    expectTypeOf<Worker>().toExtend<TreeWorker>();
    expectTypeOf<Window & typeof globalThis>().toExtend<TreeWorkerScope>();
  });

  it('does everything the port promises, as the in-memory reference tree does', async () => {
    const reference = await scenario(new MemoryStorageTree());
    const system = new MemorySyncFileSystem();
    const served = await scenario(servedPair(() => Promise.resolve(system.root())).tree);

    expect(served).toEqual(reference);
    // The scenario ends having removed the root's every entry.
    expect(system.files()).toEqual(new Map());
  });

  it('refuses a write past the quota, before losing any byte of the file it would replace', async () => {
    const quota = { quotaBytes: 4 };
    const reference = new MemoryStorageTree(quota);
    const system = new MemorySyncFileSystem(quota);
    const { tree } = servedPair(() => Promise.resolve(system.root()));

    for (const one of [reference, tree]) {
      await one.writeFile('f.bin', bytes(1, 2, 3));
      await expect(one.writeFile('f.bin', bytes(1, 2, 3, 4, 5, 6))).rejects.toMatchObject({
        kind: TreeFailureKind.Quota,
      });
      expect(await one.readFile('f.bin')).toEqual(bytes(1, 2, 3));
    }
    const sink = await tree.createFile('g.bin');
    await expect(sink.write(bytes(1, 2))).rejects.toMatchObject({ kind: TreeFailureKind.Quota });
  });

  it('can leave a write that fails after sizing its file torn at its full length', async () => {
    // What the in-memory tree's `full-length` tear stands for: a caller cannot
    // judge a file whole by its size.
    const system = new MemorySyncFileSystem({
      refuse: (asked) =>
        asked === 'write' ? new DOMException('Lost.', 'UnknownError') : undefined,
    });
    const { tree } = servedPair(() => Promise.resolve(system.root()));
    await expect(tree.writeFile('f.bin', bytes(1, 2, 3))).rejects.toBeInstanceOf(TreeFailure);
    expect(system.files().get('f.bin')).toEqual(bytes(0, 0, 0));

    const reference = new MemoryStorageTree({ crashAt: 1, tornWrite: 'full-length' });
    await expect(reference.writeFile('f.bin', bytes(1, 2, 3))).rejects.toThrow();
    expect(await reference.restarted().readFile('f.bin')).toEqual(bytes(1, 0, 0));
  });

  it('removes what an abandoned sink wrote, leaving no partial file', async () => {
    const system = new MemorySyncFileSystem();
    const { tree } = servedPair(() => Promise.resolve(system.root()));
    await tree.writeFile('keep.bin', bytes(1));

    const sink = await tree.createFile('media/partial.bin');
    await sink.write(bytes(1, 2, 3));
    expect(system.files().get('media/partial.bin')).toEqual(bytes(1, 2, 3));
    await sink.abort(new Error('The import was cancelled.'));

    expect([...system.files().keys()]).toEqual(['keep.bin']);
    expect(await tree.list('media')).toEqual([]);
  });

  it('leaves the caller its own bytes, although the copy it sends is moved', async () => {
    const pair = servedPair(() => Promise.resolve(new MemorySyncFileSystem().root()));
    const written = bytes(1, 2, 3);
    await pair.tree.writeFile('f.bin', written);

    expect(written).toEqual(bytes(1, 2, 3));
    const sent = pair.toWorker.find(
      (message) => typeof message === 'object' && message !== null && 'bytes' in message,
    );
    expect(sent).toMatchObject({ type: 'write-file', path: 'f.bin' });
  });

  it('orders changes to one file, whose access handle is exclusive, and lands them as sent', async () => {
    const system = new MemorySyncFileSystem();
    const { tree } = servedPair(() => Promise.resolve(system.root()));

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
    const system = new MemorySyncFileSystem();
    const { tree } = servedPair(() => Promise.resolve(system.root()));
    const sink = await tree.createFile('f.bin');
    await Promise.all([sink.write(bytes(1)), sink.write(bytes(2, 3)), sink.write(bytes(4))]);
    await sink.close();
    expect(system.files().get('f.bin')).toEqual(bytes(1, 2, 3, 4));
  });

  it('reads while a file is being written, since a read takes no access handle', async () => {
    const system = new MemorySyncFileSystem();
    const { tree } = servedPair(() => Promise.resolve(system.root()));
    const sink = await tree.createFile('f.bin');
    await sink.write(bytes(1));
    expect(await tree.readFile('f.bin')).toEqual(bytes(1));
    await sink.close();
  });
});

describe('the platform refusals the tree reports', () => {
  const refusing = (name: string, operation: string): MemorySyncOptions => ({
    refuse: (asked) => (asked === operation ? new DOMException('Refused.', name) : undefined),
  });

  it.each([
    ['QuotaExceededError', TreeFailureKind.Quota],
    ['SecurityError', TreeFailureKind.Unavailable],
    ['InvalidStateError', TreeFailureKind.Unavailable],
    ['NoModificationAllowedError', TreeFailureKind.Io],
    ['UnknownError', TreeFailureKind.Io],
  ])('reports %s as %s, with the platform error as the cause', async (name, kind) => {
    const system = new MemorySyncFileSystem(refusing(name, 'write'));
    const { tree } = servedPair(() => Promise.resolve(system.root()));

    const failure = await tree.writeFile('f.bin', bytes(1)).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TreeFailure);
    expect(failure).toMatchObject({ kind, cause: { name } });
  });

  it('reads a file that is not there as absent, not as a failure', async () => {
    const system = new MemorySyncFileSystem(refusing('NotFoundError', 'snapshot'));
    const { tree } = servedPair(() => Promise.resolve(system.root()));
    await tree.writeFile('f.bin', bytes(1));

    expect(await tree.readFile('f.bin')).toBeUndefined();
    expect(await tree.openFile('f.bin')).toBeUndefined();
  });

  it('reports storage the browser refuses to open as unavailable, for every operation', async () => {
    const { tree } = servedPair(() =>
      Promise.reject(new DOMException('Private browsing.', 'SecurityError')),
    );
    await expect(tree.readFile('f.bin')).rejects.toMatchObject({
      kind: TreeFailureKind.Unavailable,
    });
    await expect(tree.list('')).rejects.toMatchObject({ kind: TreeFailureKind.Unavailable });
  });

  it('reports a worker offered no private storage as unavailable', async () => {
    const { tree } = workerPair((scope) => {
      serveOriginPrivateTree(scope, undefined);
    });
    await expect(tree.writeFile('f.bin', bytes(1))).rejects.toMatchObject({
      kind: TreeFailureKind.Unavailable,
      cause: { name: 'NotSupportedError' },
    });
  });

  it('reports a worker the browser refuses to make as unavailable', async () => {
    const tree = startOriginPrivateTree(() => {
      throw new DOMException('Refused by the security policy.', 'SecurityError');
    });
    await expect(tree.list('')).rejects.toMatchObject({ kind: TreeFailureKind.Unavailable });
  });

  it('fails every waiting and later operation as unavailable once the worker fails', async () => {
    const pair = workerPair();
    const waiting = pair.tree.readFile('f.bin');
    pair.fail();
    await expect(waiting).rejects.toMatchObject({ kind: TreeFailureKind.Unavailable });
    await expect(pair.tree.list('')).rejects.toMatchObject({ kind: TreeFailureKind.Unavailable });
  });

  it('treats an answer the protocol does not allow as a defect, not a storage failure', async () => {
    const pair = workerPair();
    const waiting = pair.tree.readFile('f.bin');
    pair.sendToPage({ type: 'bytes', id: 0, bytes: 'not a buffer' });
    const failure = await waiting.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(TreeFailure);
    await expect(pair.tree.list('')).rejects.not.toBeInstanceOf(TreeFailure);
  });
});

describe('the paths the tree holds', () => {
  it('refuses a path no tree can hold where it is called, sending nothing', async () => {
    const pair = servedPair(() => Promise.resolve(new MemorySyncFileSystem().root()));
    await expect(pair.tree.readFile('A.bin')).rejects.toThrow(/Not a tree path/);
    await expect(pair.tree.list('a/../b')).rejects.toThrow(/Not a tree path/);
    await expect(pair.tree.createFile('')).rejects.toThrow(/root of the tree/);
    expect(pair.toWorker).toEqual([]);
  });

  it('leaves out of a listing an entry the tree could not have written', async () => {
    const system = new MemorySyncFileSystem();
    system.plant('Desktop.ini');
    const { tree } = servedPair(() => Promise.resolve(system.root()));
    await tree.writeFile('a.bin', bytes(1));
    expect(await tree.list('')).toEqual([{ name: 'a.bin', kind: 'file' }]);
  });
});

describe('abandoning an operation', () => {
  it('rejects with the reason at once, sending nothing, where the signal has already aborted', async () => {
    const pair = servedPair(() => Promise.resolve(new MemorySyncFileSystem().root()));
    const reason = new Error('No longer wanted.');
    await expect(pair.tree.readFile('f.bin', AbortSignal.abort(reason))).rejects.toBe(reason);
    expect(pair.toWorker).toEqual([]);
  });

  it('tells the worker, which drops a change still waiting its turn', async () => {
    const system = new MemorySyncFileSystem();
    const pair = servedPair(() => Promise.resolve(system.root()));
    const sink = await pair.tree.createFile('f.bin');

    const controller = new AbortController();
    const reason = new Error('No longer wanted.');
    const waiting = pair.tree.writeFile('f.bin', bytes(9), controller.signal);
    controller.abort(reason);
    await expect(waiting).rejects.toBe(reason);

    await sink.write(bytes(1));
    await sink.close();
    expect(system.files().get('f.bin')).toEqual(bytes(1));
    expect(pair.toWorker).toContainEqual({ type: 'cancel', target: 1 });
    expect(pair.toPage).toContainEqual({ type: 'cancelled', id: 1 });
  });
});
