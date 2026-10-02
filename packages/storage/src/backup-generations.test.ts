import { describe, expect, it } from 'vitest';

import type { ProjectId } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree, memorySource } from '@audiogubbins/media-store/testing';
import type { BackupPolicy, ByteSink, ContentId, StorageTree } from '@audiogubbins/project-format';

import { BackupGenerations } from './backup-generations.js';
import { BackupScheduler, type BackupTick, type ExternalBackupTarget } from './backup-scheduler.js';
import { retainedMedia } from './media-roots.js';
import { openProject } from './project-opening.js';
import type { ProjectSession } from './project-session.js';
import { exportBackup, importBundle } from './project-transfer.js';
import { ProjectPaths } from './storage-layout.js';
import { sweepCrashes } from './testing/crash-sweep.js';
import { summaryOf } from './testing/model-summary.js';
import { memorySink, storageOf, storedMedia, type TestStorage } from './testing/memory-ports.js';
import { addAsset, setName } from './testing/test-commands.js';
import { madeProject, openToWrite, type Harness } from './testing/storage-harness.js';
import { harness, nodeDigest } from './testing/node-services.js';

/**
 * Backup generations (REQ-STOR-105): made as the policy says when the
 * application ticks, pruned by its retention but never a protected or manual
 * one, kept apart from the history, exportable as a bundle that brings the
 * project back as it was, written into the chosen backup directory where the
 * policy asks, and counted among the roots media is never purged from.
 */

const EVERY_THREE: BackupPolicy = {
  kind: 'automatic',
  trigger: { everyChanges: 3 },
  retention: { count: 2 },
};

interface Setup {
  readonly test: Harness;
  readonly storage: TestStorage;
  readonly project: ProjectId;
  readonly session: ProjectSession;
  readonly scheduler: BackupScheduler;
  readonly generations: BackupGenerations;
  readonly media: ContentId;
}

async function setUp(
  policy: BackupPolicy = EVERY_THREE,
  external?: ExternalBackupTarget,
  tree: StorageTree = new MemoryStorageTree(),
): Promise<Setup> {
  const test = harness();
  const storage = storageOf(test, tree);
  const media = await storedMedia(storage.store, 1);
  const header = await madeProject(test, storage.tree);
  const session = await openToWrite(test, storage.tree, header.id);
  expectSuccess(await session.setBackupPolicy(policy));
  expectSuccess(await session.run(addAsset(test.ids.next<'AssetId'>(), media)));
  return {
    test,
    storage,
    project: header.id,
    session,
    scheduler: new BackupScheduler(header.id, storage.exporting, external),
    generations: new BackupGenerations(storage.tree, nodeDigest, header.id),
    media,
  };
}

async function changes(setup: Setup, count: number): Promise<void> {
  for (let step = 0; step < count; step += 1) {
    expectSuccess(await setup.session.run(setName(`Take ${String(setup.test.clock.now())}`)));
  }
}

async function tick(setup: Setup): Promise<BackupTick> {
  return expectSuccess(
    await setup.scheduler.tick(setup.test.clock.now(), setup.session.getSnapshot().model),
  );
}

async function numbers(setup: Setup): Promise<readonly number[]> {
  const listing = expectSuccess(await setup.generations.list());
  return listing.generations.map(({ number }) => number);
}

describe('backup generations (REQ-STOR-105)', () => {
  it('makes a generation when the policy says, and none while nothing changed', async () => {
    const setup = await setUp();
    // The asset added when the project was set up is the first of three changes.
    await changes(setup, 1);
    expect((await tick(setup)).kind).toBe('not-due');
    await changes(setup, 1);
    expect((await tick(setup)).kind).toBe('made');
    expect((await tick(setup)).kind).toBe('not-due');
    await changes(setup, 2);
    expect((await tick(setup)).kind).toBe('not-due');
    await changes(setup, 1);
    const made = await tick(setup);
    expect(made).toMatchObject({ kind: 'made', generation: { number: 2, reason: 'save' } });
  });

  it('reads a generation back whole once its project’s own history files are gone', async () => {
    const setup = await setUp();
    await changes(setup, 2);
    expect((await tick(setup)).kind).toBe('made');
    const [number] = await numbers(setup);
    if (number === undefined) throw new Error('A generation was made.');
    expectSuccess(await setup.session.close());
    const { tree } = setup.storage;
    const segments = new ProjectPaths(setup.project).segments;
    expect((await tree.list(segments)).length).toBeGreaterThan(0);
    for (const entry of await tree.list(segments)) await tree.remove(`${segments}/${entry.name}`);

    const copy = expectSuccess(await setup.generations.copyOf(number));
    expect(copy.model.history.nodes.size).toBe(
      setup.session.getSnapshot().model.history.nodes.size,
    );
  });

  it('prunes by retention, but never a protected or a manual generation', async () => {
    const setup = await setUp();
    await changes(setup, 3);
    await tick(setup);
    expectSuccess(await setup.generations.protect(1, true));
    const manual = expectSuccess(
      await setup.scheduler.backUpNow(setup.test.clock.now(), setup.session.getSnapshot().model),
    );
    expect(manual).toMatchObject({ generation: { reason: 'manual', protected: true } });
    for (let round = 0; round < 5; round += 1) {
      await changes(setup, 3);
      await tick(setup);
    }
    const kept = await numbers(setup);
    expect(kept).toContain(1);
    expect(kept).toContain(2);
    expect(kept.filter((number) => number > 2)).toHaveLength(2);

    expectSuccess(await setup.generations.protect(1, false));
    await changes(setup, 3);
    await tick(setup);
    expect(await numbers(setup)).not.toContain(1);
    expect(await numbers(setup)).toContain(2);
  });

  it('exports a generation as a bundle that brings the project back as it was then', async () => {
    const setup = await setUp();
    await changes(setup, 3);
    const then = summaryOf(setup.session.getSnapshot().model);
    const made = await tick(setup);
    if (made.kind !== 'made') throw new Error('No generation was made.');
    await changes(setup, 2);

    const sink = memorySink();
    expectSuccess(
      expectSuccess(
        await exportBackup(
          setup.project,
          made.generation.number,
          sink,
          { scope: { kind: 'whole-history' }, includeCaches: false },
          setup.storage.exporting,
        ),
      ).written,
    );
    const other = harness(40);
    const target = storageOf(other, new MemoryStorageTree());
    expectSuccess(await importBundle(memorySource(sink.bytes()), 'original', target.importing));
    const opened = expectSuccess(
      await openProject({ project: setup.project, access: 'read' }, other.services(target.tree)),
    );
    if (opened.kind !== 'read-only') throw new Error('Expected read-only.');
    const restored = JSON.parse(summaryOf(opened.view.getSnapshot().model)) as Record<
      string,
      unknown
    >;
    const expected = JSON.parse(then) as Record<string, unknown>;
    expect({ ...restored, backup: null, comparison: null }).toEqual({
      ...expected,
      backup: null,
      comparison: null,
    });
  });

  it('writes each generation into the chosen backup directory where the policy asks', async () => {
    const written: { name: string; sink: ReturnType<typeof memorySink> }[] = [];
    const target: ExternalBackupTarget = {
      create: (generation) => {
        const sink = memorySink();
        written.push({ name: `${generation.name} ${String(generation.number)}`, sink });
        const port: ByteSink = sink;
        return Promise.resolve(port);
      },
    };
    const setup = await setUp({ ...EVERY_THREE, external: true }, target);
    await changes(setup, 3);
    expect(await tick(setup)).toMatchObject({ kind: 'made', external: { kind: 'written' } });
    expect(written).toHaveLength(1);
    expect(written[0]?.sink.ending).toBe('closed');
    const other = storageOf(harness(41), new MemoryStorageTree());
    expectSuccess(
      await importBundle(
        memorySource(written[0]?.sink.bytes() ?? new Uint8Array()),
        'original',
        other.importing,
      ),
    );

    const without = await setUp(EVERY_THREE, target);
    await changes(without, 3);
    expect(await tick(without)).toMatchObject({ external: { kind: 'not-asked' } });
  });

  it('counts a generation’s media among the roots, until the project and its generations are purged', async () => {
    const setup = await setUp();
    await changes(setup, 3);
    await tick(setup);
    const snapshot = (setup.storage.tree as MemoryStorageTree).snapshot();
    const onlyBackups = new MemoryStorageTree(
      {},
      new Map([...snapshot].filter(([path]) => !path.startsWith('projects/'))),
    );
    const roots = new Set<ContentId>();
    for await (const root of retainedMedia(onlyBackups, nodeDigest, () => undefined))
      roots.add(root);
    expect(roots).toContain(setup.media);

    expectSuccess(await setup.session.close());
    const repository = setup.test.repository(setup.storage.tree);
    const deleted = expectSuccess(await repository.softDelete(setup.project));
    expectSuccess(
      await repository.purgeProject(setup.project, { deletedAt: deleted.deleted ?? 0 }),
    );
    expect(
      (setup.storage.tree as MemoryStorageTree)
        .paths()
        .filter((path) => path.startsWith('backups/')),
    ).toEqual([]);
  });

  it('never lists a generation a crash cut short as a backup, and prunes what it left', async () => {
    const setup = await setUp();
    await changes(setup, 3);
    let leftIncomplete = 0;
    await sweepCrashes({
      from: setup.storage.tree as MemoryStorageTree,
      run: async (crashing) =>
        await new BackupScheduler(setup.project, storageOf(setup.test, crashing).exporting).tick(
          setup.test.clock.now(),
          setup.session.getSnapshot().model,
        ),
      check: async (after, { outcome }) => {
        const listing = expectSuccess(
          await new BackupGenerations(after, nodeDigest, setup.project).list(),
        );
        // Whatever the crash cut short, every generation listed is whole.
        for (const { number } of listing.generations) {
          expectSuccess(
            await new BackupGenerations(after, nodeDigest, setup.project).copyOf(number),
          );
        }
        // What the crash left of a generation is no backup, so it holds no purge back.
        const unreadable: string[] = [];
        const roots = new Set<ContentId>();
        const gathered = retainedMedia(after, nodeDigest, ({ path }) => unreadable.push(path));
        for await (const root of gathered) roots.add(root);
        expect(unreadable).toEqual([]);
        expect(roots).toContain(setup.media);
        if (outcome !== undefined) return;
        if (listing.incomplete.length > 0) leftIncomplete += 1;
        // The next generation made prunes what the crash left.
        const next = new BackupScheduler(setup.project, storageOf(setup.test, after).exporting);
        expectSuccess(await next.tick(setup.test.clock.now(), setup.session.getSnapshot().model));
        const tidied = expectSuccess(
          await new BackupGenerations(after, nodeDigest, setup.project).list(),
        );
        expect(tidied.incomplete).toEqual([]);
        expect(tidied.generations.length).toBeGreaterThan(0);
      },
    });
    expect(leftIncomplete).toBeGreaterThan(0);
  }, 120_000);
});
