import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree, memorySource } from '@audiogubbins/media-store/testing';

import { planCleanup } from './cleanup-planning.js';
import { runCleanup } from './cleanup-running.js';
import type { CatalogueEntry } from './project-catalogue.js';
import { openProject } from './project-opening.js';
import { exportBundle, importBundle } from './project-transfer.js';
import { sweepCrashes } from './testing/crash-sweep.js';
import { summaryOf } from './testing/model-summary.js';
import { memorySink, storageOf, storedMedia } from './testing/memory-ports.js';
import { harness } from './testing/node-services.js';
import { madeProject, openToWrite, type Harness } from './testing/storage-harness.js';
import { addAsset, setName } from './testing/test-commands.js';

/**
 * A crash at any moment of bringing a bundle in (REQ-EXEC-180, REQ-STOR-101):
 * afterwards the storage lists either nothing new or the whole project, which
 * opens as it was exported; never a project that cannot be opened. What a crash
 * left is found by cleanup and removed, and the bundle can be brought in again.
 */

async function sampleBundle(test: Harness) {
  const source = storageOf(test, new MemoryStorageTree());
  const media = [await storedMedia(source.store, 1), await storedMedia(source.store, 2)];
  const header = await madeProject(test, source.tree);
  const session = await openToWrite(test, source.tree, header.id);
  for (const [index, content] of media.entries()) {
    expectSuccess(await session.run(addAsset(test.ids.next<'AssetId'>(), content)));
    expectSuccess(await session.run(setName(`Take ${String(index)}`)));
  }
  expectSuccess(await session.createSnapshot({ name: 'Kept' }));
  const summary = summaryOf(session.getSnapshot().model);
  expectSuccess(await session.close());
  const sink = memorySink();
  expectSuccess(
    expectSuccess(
      await exportBundle(
        header.id,
        sink,
        { scope: { kind: 'whole-history' }, includeCaches: false },
        source.exporting,
      ),
    ).written,
  );
  return { project: header.id, bundle: sink.bytes(), summary };
}

async function listed(test: Harness, tree: MemoryStorageTree): Promise<readonly CatalogueEntry[]> {
  const entries: CatalogueEntry[] = [];
  for await (const entry of test.repository(tree).list()) entries.push(entry);
  return entries;
}

function withoutStoragePolicies(summary: string): unknown {
  const {
    backup: _backup,
    comparison: _comparison,
    ...rest
  } = JSON.parse(summary) as Record<string, unknown>;
  return rest;
}

describe('a crash while a bundle is brought in (REQ-EXEC-180)', () => {
  it('leaves nothing listed or the whole project, at every operation', async () => {
    const test = harness(31);
    const { project, bundle, summary } = await sampleBundle(test);
    const operations = await sweepCrashes({
      from: new MemoryStorageTree(),
      run: async (tree) =>
        await importBundle(memorySource(bundle), 'original', storageOf(test, tree).importing),
      check: async (after, { outcome }) => {
        const entries = await listed(test, after);
        if (outcome !== undefined) {
          expectSuccess(outcome);
          expect(entries).toHaveLength(1);
          return;
        }
        expect(entries.every((entry) => entry.kind === 'project')).toBe(true);
        if (entries.length === 1) {
          const opened = expectSuccess(
            await openProject({ project, access: 'read' }, test.services(after)),
          );
          if (opened.kind !== 'read-only') throw new Error('Expected read-only.');
          expect(withoutStoragePolicies(summaryOf(opened.view.getSnapshot().model))).toEqual(
            withoutStoragePolicies(summary),
          );
          return;
        }

        // Whatever the crash left is cleaned up, and the bundle comes in whole.
        const restarted = storageOf(test, after);
        expectSuccess(await restarted.store.recoverIncomplete());
        const services = restarted.cleaning;
        const plan = expectSuccess(await planCleanup('everything', services, 0));
        expectSuccess(await runCleanup(plan, { bytes: plan.confirmationBytes }, services));
        expectSuccess(await importBundle(memorySource(bundle), 'original', restarted.importing));
        expect(await listed(test, after)).toHaveLength(1);
      },
    });
    expect(operations).toBeGreaterThan(20);
  }, 120_000);
});
