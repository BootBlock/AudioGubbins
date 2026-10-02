import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { openProject } from '@audiogubbins/storage';

import { SETTINGS, memoryStorage } from '../testing/memory-storage.js';

describe('the library, asked of the storage worker', () => {
  it('lists each project made, with the header it was made with', async () => {
    const { client } = memoryStorage();

    const made = expectSuccess(
      await client.library.create({ name: ' Forest walk ', settings: SETTINGS }),
    );

    expect(made).toMatchObject({ name: 'Forest walk', generation: 1 });
    await expect(client.library.list()).resolves.toEqual([{ kind: 'project', header: made }]);
  });

  it('answers a refusal as the failure it is', async () => {
    const { client } = memoryStorage();

    const refused = await client.library.create({ name: '  ', settings: SETTINGS });

    expect(expectFailureCode(refused)).toBe('project.name-blank');
    await expect(client.library.list()).resolves.toEqual([]);
  });

  it('deletes, restores and purges a project', async () => {
    const { client } = memoryStorage();
    const { id } = expectSuccess(await client.library.create({ name: 'Rain', settings: SETTINGS }));

    const deleted = expectSuccess(await client.library.softDelete(id));
    expect(deleted.deleted).toBeTypeOf('number');
    expect(await client.library.list()).toEqual([{ kind: 'project', header: deleted }]);

    const restored = expectSuccess(await client.library.restore(id));
    expect(restored.deleted).toBeUndefined();

    const again = expectSuccess(await client.library.softDelete(id));
    const unconfirmed = await client.library.purge(id, { deletedAt: (again.deleted ?? 0) - 1 });
    expect(expectFailureCode(unconfirmed)).toBe('storage.purge-unconfirmed');
    expectSuccess(await client.library.purge(id, { deletedAt: again.deleted ?? 0 }));
    await expect(client.library.list()).resolves.toEqual([]);
  });

  it('forks a project from a node of its history', async () => {
    const { client, another } = memoryStorage();
    const source = expectSuccess(
      await client.library.create({ name: 'Harbour', settings: SETTINGS }),
    );
    const opened = expectSuccess(
      await openProject({ project: source.id, access: 'read' }, another),
    );
    if (opened.kind !== 'read-only') throw new Error(`The source opened ${opened.kind}.`);
    const root = opened.view.getSnapshot().model.history.root;
    opened.view.close();

    const fork = expectSuccess(
      await client.library.fork({
        source: source.id,
        from: { kind: 'node', node: root },
        name: 'Harbour at dusk',
      }),
    );

    expect(fork.id).not.toBe(source.id);
    const names = (await client.library.list()).map((entry) =>
      entry.kind === 'project' ? entry.header.name : entry.name,
    );
    expect(names.toSorted()).toEqual(['Harbour', 'Harbour at dusk']);

    const unseen = await client.library.fork({
      source: source.id,
      from: { kind: 'node', node: root },
      name: '\u200B',
    });
    expect(expectFailureCode(unseen)).toBe('project.name-blank');
    expect(await client.library.list()).toHaveLength(2);
  });
});
