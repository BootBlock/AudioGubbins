import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree, memorySource } from '@audiogubbins/media-store/testing';

import { BackupScheduler } from './backup-scheduler.js';
import { planCleanup } from './cleanup-planning.js';
import { runCleanup } from './cleanup-running.js';
import type { ProjectHeader } from './project-header.js';
import { openProject } from './project-opening.js';
import { sweepCrashes } from './testing/crash-sweep.js';
import { exportBundle, importBundle } from './project-transfer.js';
import { memorySink, storageOf } from './testing/memory-ports.js';
import { summaryOf } from './testing/model-summary.js';
import { harness } from './testing/node-services.js';
import { madeProject, openToWrite } from './testing/storage-harness.js';
import { setName } from './testing/test-commands.js';

/**
 * A crash at any moment of purging a deleted project (REQ-STOR-102,
 * REQ-EXEC-180): afterwards the project is gone, or still listed as deleted.
 * One still listed is either untouched, and restores to the project it was, or
 * marked as being purged, which restoring refuses, since its files may be part
 * gone; and purging it again, as it was confirmed, cleanup, or bringing the
 * project in again as itself, removes what is left of it and its backups for
 * good.
 */

describe('a crash while a deleted project is purged (REQ-STOR-102)', () => {
  it('leaves it gone, whole and restorable, or refused restoring and purged again', async () => {
    const test = harness(51);
    const from = new MemoryStorageTree();
    const header = await madeProject(test, from);
    const session = await openToWrite(test, from, header.id);
    expectSuccess(await session.run(setName('Kept')));
    const storage = storageOf(test, from);
    const scheduler = new BackupScheduler(header.id, storage.exporting);
    expectSuccess(await scheduler.backUpNow(test.clock.now(), session.getSnapshot().model));
    expectSuccess(await session.close());
    const summary = summaryOf(session.getSnapshot().model);
    const deleted = expectSuccess(await test.repository(from).softDelete(header.id));
    const confirmation = { deletedAt: deleted.deleted ?? 0 };

    const sink = memorySink();
    expectSuccess(
      expectSuccess(
        await exportBundle(
          header.id,
          sink,
          { scope: { kind: 'whole-history' }, includeCaches: false },
          storage.exporting,
        ),
      ).written,
    );
    const bundle = sink.bytes();

    /** Cleanup finishes a purge a crash cut short, as the person confirmed it. */
    const finishedByCleanup = async (tree: MemoryStorageTree): Promise<void> => {
      const services = storageOf(harness(57), tree).cleaning;
      const plan = expectSuccess(await planCleanup([{ kind: 'unfinished-projects' }], services, 0));
      expectSuccess(await runCleanup(plan, { bytes: plan.confirmationBytes }, services));
      expect(leftOf(tree)).toEqual([]);
    };

    /** The project brought in again as itself takes the place of one being purged. */
    const finishedByImport = async (tree: MemoryStorageTree): Promise<void> => {
      const test = harness(58);
      expectSuccess(
        await importBundle(memorySource(bundle), 'original', storageOf(test, tree).importing),
      );
      const opened = expectSuccess(
        await openProject({ project: header.id, access: 'read' }, test.services(tree)),
      );
      if (opened.kind !== 'read-only') throw new Error('Expected read-only.');
      expect(opened.view.getSnapshot().model.state.project.displayName).toBe('Kept');
    };

    let refused = 0;
    const leftOf = (tree: MemoryStorageTree) =>
      tree.paths().filter((path) => path.includes(header.id));
    const operations = await sweepCrashes({
      from,
      run: async (tree) => await harness(52).repository(tree).purgeProject(header.id, confirmation),
      check: async (found, { outcome }) => {
        if (outcome !== undefined) expectSuccess(outcome);
        const listed: ProjectHeader[] = [];
        for await (const entry of harness(53).repository(found).list()) {
          if (entry.kind !== 'project') throw new Error(`${entry.name} cannot be read.`);
          listed.push(entry.header);
        }
        if (listed.length === 0) {
          expect(leftOf(found)).toEqual([]);
          return;
        }
        expect(listed).toMatchObject([{ id: header.id, deleted: confirmation.deletedAt }]);

        // Restored in a copy of what was found, so the purge can go on after.
        const copy = found.restarted();
        const restored = await harness(54).repository(copy).restore(header.id);
        if (restored.ok) {
          const opened = expectSuccess(
            await openProject({ project: header.id, access: 'read' }, harness(55).services(copy)),
          );
          if (opened.kind !== 'read-only') throw new Error('Expected read-only.');
          expect(summaryOf(opened.view.getSnapshot().model)).toBe(summary);
        } else {
          expect(expectFailureCode(restored)).toBe('storage.project-purging');
          refused += 1;
          await finishedByCleanup(found.restarted());
          await finishedByImport(found.restarted());
        }

        expectSuccess(await harness(56).repository(found).purgeProject(header.id, confirmation));
        expect(leftOf(found)).toEqual([]);
      },
    });
    expect(operations).toBeGreaterThan(5);
    expect(refused).toBeGreaterThan(0);
  }, 120_000);
});
