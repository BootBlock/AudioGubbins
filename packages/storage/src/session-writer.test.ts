import { afterEach, describe, expect, it, vi } from 'vitest';

import { FailureKind, fail, failure } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { activeLine } from '@audiogubbins/history';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';

import { CheckedRecords } from './checked-records.js';
import { readHeads } from './project-heads.js';
import { ProjectFiles } from './project-files.js';
import { recordTooLarge } from './storage-failures.js';
import { harness, nodeDigest } from './testing/node-services.js';
import { madeProject, openToWrite, type Harness } from './testing/storage-harness.js';
import { setName } from './testing/test-commands.js';

/**
 * A checkpoint is refused before it is written where its reader could not read
 * it back. The project must not stop saving over it, since every change is in
 * the journal still, and must not lose the checkpoint it would have replaced.
 */

const CADENCE = { checkpointAfter: 2, keepStateEvery: 64 };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a checkpoint larger than storage can read back', () => {
  it('is passed over: the project stays saved, and nothing it would replace is removed', async () => {
    const test = harness();
    const tree = new MemoryStorageTree();
    const header = await madeProject(test, tree);
    const files = new ProjectFiles(new CheckedRecords(tree, nodeDigest), header.id);
    const session = await openToWrite(test, tree, header.id, { cadence: CADENCE });
    const heads = await readHeads(files.records, files.paths);
    const refused = vi
      .spyOn(ProjectFiles.prototype, 'writeCheckpoint')
      .mockResolvedValue(
        fail(
          recordTooLarge(
            'checkpoint',
            failure('json.too-long', FailureKind.IntegrityViolation, 'Too long.'),
          ),
        ),
      );

    for (const name of ['One', 'Two', 'Three', 'Four', 'Five']) {
      expectSuccess(await session.run(setName(name)));
    }
    expect(refused).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot().save).toEqual({ kind: 'saved' });
    expect(await readHeads(files.records, files.paths)).toEqual(heads);

    expectSuccess(await session.close());
    refused.mockRestore();
    const reopened = await openToWrite(test, tree, header.id, { cadence: CADENCE });
    expect(reopened.getSnapshot().model.state.project.displayName).toBe('Five');
  });
});

/** A tree that counts the files written to it. */
class CountingTree extends MemoryStorageTree {
  written = 0;

  override async writeFile(path: string, bytes: Uint8Array): Promise<void> {
    this.written += 1;
    await super.writeFile(path, bytes);
  }

  override async createFile(path: string) {
    this.written += 1;
    return await super.createFile(path);
  }
}

/** How many files `work` writes to `tree`. */
async function writesOf(tree: CountingTree, work: () => Promise<unknown>): Promise<number> {
  const before = tree.written;
  await work();
  return tree.written - before;
}

async function openedOver(test: Harness, tree: CountingTree) {
  const header = await madeProject(test, tree);
  return { header, session: await openToWrite(test, tree, header.id) };
}

describe('a checkpoint asked for when nothing changed', () => {
  it('writes nothing, as when a page is hidden twice, and writes again after a change', async () => {
    const tree = new CountingTree();
    const { session } = await openedOver(harness(), tree);
    expect(await writesOf(tree, async () => expectSuccess(await session.checkpoint()))).toBe(0);

    expectSuccess(await session.run(setName('Changed')));
    expect(
      await writesOf(tree, async () => expectSuccess(await session.checkpoint())),
    ).toBeGreaterThan(0);
    expect(await writesOf(tree, async () => expectSuccess(await session.checkpoint()))).toBe(0);
    expect(session.getSnapshot().save).toEqual({ kind: 'saved' });
  });

  it('is written once after an opening that replayed the journal', async () => {
    const tree = new CountingTree();
    const { header, session } = await openedOver(harness(), tree);
    expectSuccess(await session.run(setName('Journalled only')));

    // A second storage holds what the first did when its window went away.
    const after = new CountingTree({}, tree.snapshot());
    const reopened = await openToWrite(harness(12), after, header.id);
    expect(
      await writesOf(after, async () => expectSuccess(await reopened.checkpoint())),
    ).toBeGreaterThan(0);
    expect(await writesOf(after, async () => expectSuccess(await reopened.checkpoint()))).toBe(0);
  });

  it('still writes a compaction made right after a checkpoint, which no record names', async () => {
    const test = harness();
    const tree = new CountingTree();
    const { header, session } = await openedOver(test, tree);
    for (const name of ['One', 'Two', 'Three']) expectSuccess(await session.run(setName(name)));
    expectSuccess(await session.checkpoint());

    const newRoot = activeLine(session.getSnapshot().model.history)[2]?.id;
    if (newRoot === undefined) throw new Error('No third node.');
    const plan = expectSuccess(await session.planCompaction({ kind: 'before', node: newRoot }));
    expectSuccess(await session.compactHistory(plan, plan));
    expectSuccess(await session.close());

    const reopened = await openToWrite(test, tree, header.id);
    expect(reopened.getSnapshot().model.history.root).toBe(newRoot);
  });
});
