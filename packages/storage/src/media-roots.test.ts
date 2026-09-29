import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import type { ContentId } from '@audiogubbins/project-format';

import { retainedMedia, type UnreadableRoot } from './media-roots.js';
import { addAsset, contentOf } from './testing/test-commands.js';
import { madeProject, openToWrite } from './testing/storage-harness.js';
import { harness, nodeDigest } from './testing/node-services.js';

async function rootsOf(tree: MemoryStorageTree) {
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
