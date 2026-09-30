import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import type { ByteSink, ContentId, StorageTree, TreeEntry } from '@audiogubbins/project-format';

import { retainedMedia, type UnreadableRoot } from './media-roots.js';
import { addAsset, contentOf, setName } from './testing/test-commands.js';
import { madeProject, openToWrite } from './testing/storage-harness.js';
import { harness, nodeDigest } from './testing/node-services.js';

/**
 * A tree that lets another window's work run once the scan has listed a
 * project's checkpoints, and hands the scan the listing as it was before.
 */
class InterruptedTree implements StorageTree {
  private readonly inner: StorageTree;
  private readonly every: boolean;
  private interruption: (() => Promise<unknown>) | undefined;

  constructor(inner: StorageTree, interruption: () => Promise<unknown>, every = false) {
    this.inner = inner;
    this.interruption = interruption;
    this.every = every;
  }

  readFile(path: string, signal?: AbortSignal) {
    return this.inner.readFile(path, signal);
  }
  openFile(path: string) {
    return this.inner.openFile(path);
  }
  writeFile(path: string, bytes: Uint8Array, signal?: AbortSignal) {
    return this.inner.writeFile(path, bytes, signal);
  }
  createFile(path: string): Promise<ByteSink> {
    return this.inner.createFile(path);
  }
  remove(path: string) {
    return this.inner.remove(path);
  }
  async list(directory: string): Promise<readonly TreeEntry[]> {
    const listed = await this.inner.list(directory);
    const interruption = this.interruption;
    if (interruption !== undefined && directory.endsWith('/checkpoints')) {
      if (!this.every) this.interruption = undefined;
      await interruption();
    }
    return listed;
  }
}

async function rootsOf(tree: StorageTree) {
  const unreadable: UnreadableRoot[] = [];
  const roots = new Set<ContentId>();
  for await (const root of retainedMedia(tree, nodeDigest, (problem) => unreadable.push(problem))) {
    roots.add(root);
  }
  return { roots, unreadable };
}

describe('the media every project retains (REQ-STOR-102, REQ-STOR-193)', () => {
  it('keeps media an undone change or another branch holds, before and after a checkpoint', async () => {
    const test = harness();
    const tree = new MemoryStorageTree();
    const header = await madeProject(test, tree);
    const session = await openToWrite(test, tree, header.id);
    expectSuccess(await session.run(addAsset(test.ids.next<'AssetId'>(), contentOf(1))));
    expectSuccess(await session.undo());
    expectSuccess(await session.run(addAsset(test.ids.next<'AssetId'>(), contentOf(2))));

    // Content 1 is in no state kept, only in the journal's record of the change.
    expect((await rootsOf(tree)).roots).toEqual(new Set([contentOf(1), contentOf(2)]));
    expectSuccess(await session.close());
    // Now it is in the checkpoint's history, whose change redo would replay.
    expect((await rootsOf(tree)).roots).toEqual(new Set([contentOf(1), contentOf(2)]));
  });

  it('keeps a deleted project’s media until the project is purged', async () => {
    const test = harness();
    const tree = new MemoryStorageTree();
    const header = await madeProject(test, tree);
    const session = await openToWrite(test, tree, header.id);
    expectSuccess(await session.run(addAsset(test.ids.next<'AssetId'>(), contentOf(3))));
    expectSuccess(await session.close());
    const deleted = expectSuccess(await test.repository(tree).softDelete(header.id));
    expect((await rootsOf(tree)).roots).toContain(contentOf(3));
    expectSuccess(
      await test.repository(tree).purgeProject(header.id, { deletedAt: deleted.deleted ?? 0 }),
    );
    expect((await rootsOf(tree)).roots.size).toBe(0);
  });

  it('keeps media another window checkpoints while the roots are gathered', async () => {
    const test = harness();
    const tree = new MemoryStorageTree();
    const header = await madeProject(test, tree);
    const session = await openToWrite(test, tree, header.id);
    expectSuccess(await session.run(addAsset(test.ids.next<'AssetId'>(), contentOf(5))));
    expectSuccess(await session.undo());

    // Content 5 is only in the journal until the checkpoint folds it into a
    // checkpoint and prunes the journal, between the scan's two listings.
    const scanned = new InterruptedTree(tree, async () => {
      expectSuccess(await session.checkpoint());
    });
    const { roots, unreadable } = await rootsOf(scanned);
    expect(unreadable).toEqual([]);
    expect(roots).toContain(contentOf(5));
  });

  it('reports a project whose checkpoints never stop while the roots are gathered', async () => {
    const test = harness();
    const tree = new MemoryStorageTree();
    const header = await madeProject(test, tree);
    const session = await openToWrite(test, tree, header.id);
    let take = 0;
    const scanned = new InterruptedTree(
      tree,
      async () => {
        take += 1;
        expectSuccess(await session.run(setName(`Take ${String(take)}`)));
        expectSuccess(await session.checkpoint());
      },
      true,
    );
    const { unreadable } = await rootsOf(scanned);
    expect(unreadable.map(({ failure }) => failure.code)).toEqual(['storage.roots-moving']);
  });

  it('reports a file it cannot read rather than counting it as retaining nothing', async () => {
    const test = harness();
    const tree = new MemoryStorageTree();
    const header = await madeProject(test, tree);
    const session = await openToWrite(test, tree, header.id);
    expectSuccess(await session.run(addAsset(test.ids.next<'AssetId'>(), contentOf(4))));
    const record = tree.paths().find((path) => path.includes('/journal/'));
    if (record === undefined) throw new Error('No journal record.');
    await tree.writeFile(record, new Uint8Array([123, 34]));
    const { unreadable } = await rootsOf(tree);
    expect(unreadable.map((problem) => problem.path)).toEqual([record]);
  });
});
