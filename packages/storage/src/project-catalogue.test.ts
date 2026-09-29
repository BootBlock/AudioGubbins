import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree, nodeDigest } from '@audiogubbins/media-store/testing';
import { encodeUtf8, type StorageTree } from '@audiogubbins/project-format';

import { ProjectRepository, type CatalogueEntry } from './project-catalogue.js';
import { openProject } from './project-opening.js';
import {
  SETTINGS,
  WINDOW_A,
  harness,
  madeProject,
  openToWrite,
} from './testing/storage-harness.js';
import { setName } from './testing/test-commands.js';

async function listOf(
  test: ReturnType<typeof harness>,
  tree: StorageTree,
): Promise<CatalogueEntry[]> {
  const entries: CatalogueEntry[] = [];
  for await (const entry of test.repository(tree).list()) entries.push(entry);
  return entries;
}

describe('the project catalogue (REQ-STOR-025, REQ-STOR-102)', () => {
  it('makes a new project that opens at its origin', async () => {
    const test = harness();
    const tree = new MemoryStorageTree();
    const header = await madeProject(test, tree, '  Forest walk ');
    expect(header).toMatchObject({ name: 'Forest walk', generation: 1 });
    const opened = expectSuccess(
      await openProject({ project: header.id, access: 'read' }, test.services(tree)),
    );
    const view = opened.kind === 'read-only' ? opened.view.getSnapshot() : undefined;
    expect(view?.model.state.project.displayName).toBe('Forest walk');
    expect(view?.model.history.nodes.size).toBe(1);
    expect(opened.report).toMatchObject({ replayed: 0, fallbacks: [], missingStates: [] });
  });

  it('refuses a name the project document could not hold, writing nothing', async () => {
    const test = harness();
    const tree = new MemoryStorageTree();
    const repository = test.repository(tree);
    expect(expectFailureCode(await repository.create({ name: '   ', settings: SETTINGS }))).toBe(
      'project.name-empty',
    );
    const tooLong = await repository.create({ name: 'x'.repeat(2_000), settings: SETTINGS });
    expect(tooLong.ok).toBe(false);
    expect(tree.paths()).toEqual([]);
  });

  it('lists projects in identifier order, reporting what it cannot read rather than hiding it', async () => {
    const test = harness();
    const tree = new MemoryStorageTree();
    const first = await madeProject(test, tree, 'One');
    const second = await madeProject(test, tree, 'Two');
    await tree.writeFile(
      'projects/ffffffff-0000-4000-8000-000000000000/project-0.json',
      encodeUtf8('{"torn'),
    );
    const entries = await listOf(test, tree);
    const ids = [first.id, second.id].sort();
    expect(entries).toMatchObject([
      { kind: 'project', header: { id: ids[0] } },
      { kind: 'project', header: { id: ids[1] } },
      {
        kind: 'unreadable',
        name: 'ffffffff-0000-4000-8000-000000000000',
        faults: [{ kind: 'damaged' }],
      },
    ]);
  });

  it('deletes softly, keeping everything, restores, and purges only on confirmation', async () => {
    const test = harness();
    const tree = new MemoryStorageTree();
    const header = await madeProject(test, tree);
    const session = await openToWrite(test, tree, header.id);
    expectSuccess(await session.run(setName('Worked on')));
    expectSuccess(await session.close());
    const repository = test.repository(tree);
    const held = tree
      .paths()
      .filter((path) => !path.endsWith('/project-0.json') && !path.endsWith('/project-1.json'));

    const deleted = expectSuccess(await repository.softDelete(header.id));
    expect(deleted.deleted).toBeDefined();
    for (const path of held) expect(tree.paths()).toContain(path);
    expect(
      expectFailureCode(
        await openProject({ project: header.id, access: 'write' }, test.services(tree)),
      ),
    ).toBe('storage.project-deleted');

    const restored = expectSuccess(await repository.restore(header.id));
    expect(restored.deleted).toBeUndefined();
    expect(expectFailureCode(await repository.purgeProject(header.id, { deletedAt: 0 }))).toBe(
      'storage.purge-unconfirmed',
    );

    const again = expectSuccess(await repository.softDelete(header.id));
    expect(
      expectFailureCode(
        await repository.purgeProject(header.id, { deletedAt: (again.deleted ?? 0) + 1 }),
      ),
    ).toBe('storage.purge-unconfirmed');
    expectSuccess(await repository.purgeProject(header.id, { deletedAt: again.deleted ?? 0 }));
    expect(tree.paths()).toEqual([]);
    expect(await listOf(test, tree)).toEqual([]);
  });

  it('refuses to change a project without a way to coordinate writers', async () => {
    const test = harness();
    const tree = new MemoryStorageTree();
    const header = await madeProject(test, tree);
    const uncoordinated = new ProjectRepository({
      tree,
      digest: nodeDigest,
      clock: test.clock,
      ids: test.ids,
      owner: WINDOW_A,
    });
    expect(expectFailureCode(await uncoordinated.softDelete(header.id))).toBe(
      'storage.no-coordination',
    );
  });
});
