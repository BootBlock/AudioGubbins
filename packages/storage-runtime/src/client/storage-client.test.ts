import { describe, expect, it, vi } from 'vitest';

import { LogSeverity, redactRecords } from '@audiogubbins/diagnostics';
import { unsafeBrandId } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import type { ByteSink, ByteSource, StorageTree, TreeEntry } from '@audiogubbins/project-format';

import { SETTINGS, memoryStorage } from '../testing/memory-storage.js';

/** A tree in memory that counts the operations asked of it. */
class CountingTree implements StorageTree {
  readonly inner = new MemoryStorageTree();
  operations = 0;

  readFile(path: string): Promise<Uint8Array<ArrayBuffer> | undefined> {
    this.operations += 1;
    return this.inner.readFile(path);
  }

  openFile(path: string): Promise<ByteSource | undefined> {
    this.operations += 1;
    return this.inner.openFile(path);
  }

  writeFile(path: string, bytes: Uint8Array): Promise<void> {
    this.operations += 1;
    return this.inner.writeFile(path, bytes);
  }

  createFile(path: string): Promise<ByteSink> {
    this.operations += 1;
    return this.inner.createFile(path);
  }

  remove(path: string): Promise<void> {
    this.operations += 1;
    return this.inner.remove(path);
  }

  list(directory: string): Promise<readonly TreeEntry[]> {
    this.operations += 1;
    return this.inner.list(directory);
  }
}

/** A project no window holds, whose owner is asked for once records were sent. */
const NO_PROJECT = unsafeBrandId<'ProjectId'>('p-1');

/** Waits for a later task, by which a message posted now has arrived. */
function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('abandoning a call of the storage worker', () => {
  it("stops the worker's work where it next takes a turn", async () => {
    const tree = new CountingTree();
    let turning = false;
    let turned: () => void = () => undefined;
    const firstTurn = new Promise<void>((resolve) => {
      turned = resolve;
    });
    const { client, pair } = memoryStorage({
      tree,
      // A turn lets the messages waiting be read, as the worker's host does.
      yieldToHost: async () => {
        if (!turning) return;
        turned();
        await nextTask();
      },
    });
    for (const name of ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight']) {
      expectSuccess(await client.library.create({ name, settings: SETTINGS }));
    }
    const before = tree.operations;
    expect(await client.library.list()).toHaveLength(8);
    const whole = tree.operations - before;

    turning = true;
    const controller = new AbortController();
    const reason = new Error('Closed.');
    const listing = client.library.list(controller.signal);
    await firstTurn;
    const started = tree.operations;
    controller.abort(reason);

    await expect(listing).rejects.toBe(reason);
    await vi.waitFor(() => {
      expect(pair.toPage).toContainEqual({ type: 'answer', id: 9, outcome: { kind: 'cancelled' } });
    });
    const done = tree.operations - started;
    await nextTask();
    await nextTask();
    expect(tree.operations - started).toBe(done);
    expect(done).toBeLessThan(whole / 2);
  });
});

describe("the storage worker's records", () => {
  it("arrive in the page's diagnostics under their category, by the page's verbosity", async () => {
    const { client, hostLogs, logs } = memoryStorage();
    const logger = hostLogs.loggerFor('storage');

    logger.debug('A detail the page does not keep.');
    logger.warning('A linked file could not be read.', { path: '/home/someone/Music/take.wav' });
    await client.ownership.ownerOf(NO_PROJECT);

    expect(logs.snapshot()).toEqual([
      expect.objectContaining({
        severity: LogSeverity.Warning,
        category: 'storage',
        message: 'A linked file could not be read.',
        fields: { path: '/home/someone/Music/take.wav' },
      }),
    ]);
  });

  it('are redacted in a report as the records the page makes are', async () => {
    const { client, hostLogs, logs } = memoryStorage();

    hostLogs
      .loggerFor('storage')
      .error('A linked file could not be read.', { path: '/home/someone/Music/take.wav' });
    await client.ownership.ownerOf(NO_PROJECT);

    expect(redactRecords(logs.snapshot()).records).toEqual([
      expect.objectContaining({ category: 'storage', fields: { path: '<path>' } }),
    ]);
  });
});
