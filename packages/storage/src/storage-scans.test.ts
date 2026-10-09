import { describe, expect, it } from 'vitest';

import type { ProjectId } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import { countedTurns } from '@audiogubbins/project-format/testing';

import { planCleanup } from './cleanup-planning.js';
import { runCleanup } from './cleanup-running.js';
import { ProjectPaths } from './storage-layout.js';
import { storageOf } from './testing/memory-ports.js';
import { harness } from './testing/node-services.js';
import { madeProject, openToWrite } from './testing/storage-harness.js';
import { setName } from './testing/test-commands.js';
import { WatchedTree, type WatchedOperation } from './testing/watched-tree.js';
import { measureUsage } from './usage-measurement.js';

/**
 * The scans a person starts over the whole storage (REQ-STOR-200,
 * REQ-STOR-027): measuring usage, and planning and running a cleanup. Each
 * stops where its signal aborts, since the page gives one up as a newer one
 * replaces it, and takes turns through the passes it makes over a history in
 * memory, which no read interrupts.
 */

/** A file of a project's header, either slot of its pair. */
const HEADER_FILE = /\/project-\d\.json$/u;

/** Three projects, the first with changes still in its journal, over a watched tree. */
async function scannedStorage() {
  const test = harness(81);
  const tree = new WatchedTree(new MemoryStorageTree());
  const storage = storageOf(test, tree);
  const projects: ProjectId[] = [];
  for (const name of ['First', 'Second', 'Third']) {
    projects.push((await madeProject(test, tree, name)).id);
  }
  const [first] = projects;
  if (first === undefined) throw new Error('No project was made.');
  const session = await openToWrite(test, tree, first, {
    cadence: { checkpointAfter: 1_000, keepStateEvery: 1_000 },
  });
  for (const name of ['One', 'Two', 'Three', 'Four']) {
    expectSuccess(await session.run(setName(name)));
  }
  return { tree, storage, projects, session };
}

/** A signal that aborts as the work it is given reaches the operation the tree watches for. */
function abortedAt(
  tree: WatchedTree,
  operation: WatchedOperation,
  matches: (path: string) => boolean,
) {
  const controller = new AbortController();
  const reason = new Error('Replaced by a newer one.');
  tree.actAt(operation, matches, () => {
    controller.abort(reason);
  });
  return { signal: controller.signal, reason };
}

describe('measuring usage', () => {
  it('stops gathering the media the journal retains at the read its signal aborts in', async () => {
    const { tree, storage } = await scannedStorage();
    const { signal, reason } = abortedAt(tree, 'read', (path) => path.includes('/journal/'));

    await expect(measureUsage(storage.measuring, [], signal)).rejects.toBe(reason);
    // At most the listing of the journal's next folder, and no read.
    expect(tree.operationsSince).toBeLessThanOrEqual(1);
  });

  it('asks the host for turns as it sorts the states of a long history', async () => {
    const turns = countedTurns();
    const test = harness(82);
    const tree = new MemoryStorageTree();
    const storage = storageOf(test, tree, turns.yieldToHost);
    const header = await madeProject(test, tree);
    const session = await openToWrite(test, tree, header.id);
    for (let change = 0; change < 300; change += 1) {
      expectSuccess(await session.run(setName(`Name ${String(change)}`)));
    }
    expectSuccess(await session.close());
    const before = turns.asked;

    expectSuccess(await measureUsage(storage.measuring));

    // 301 nodes, on the line the project is on: two passes of a step each.
    expect(turns.asked - before).toBeGreaterThanOrEqual(4);
  });
});

describe('cleaning up', () => {
  it('stops planning at the project whose header its signal aborts in', async () => {
    const { tree, storage } = await scannedStorage();
    const { signal, reason } = abortedAt(tree, 'read', (path) => HEADER_FILE.test(path));

    const planning = planCleanup([{ kind: 'unfinished-projects' }], storage.cleaning, 0, signal);

    await expect(planning).rejects.toBe(reason);
    // The other slot of the same header, and no other project's.
    expect(tree.operationsSince).toBeLessThanOrEqual(1);
  });

  it('removes no further project once its signal aborts', async () => {
    const { tree, storage, projects, session } = await scannedStorage();
    expectSuccess(await session.close());
    for (const project of projects) {
      await tree.writeFile(
        `${new ProjectPaths(project).quarantine}/set-aside.json`,
        new Uint8Array(4),
      );
    }
    const plan = expectSuccess(
      await planCleanup([{ kind: 'set-aside-records' }], storage.cleaning, 0),
    );
    const { signal, reason } = abortedAt(tree, 'remove', (path) => path.includes('/quarantine/'));

    const running = runCleanup(plan, { bytes: plan.confirmationBytes }, storage.cleaning, {
      signal,
    });

    await expect(running).rejects.toBe(reason);
    const kept = await Promise.all(
      projects.map(
        async (project) => (await tree.list(new ProjectPaths(project).quarantine)).length,
      ),
    );
    expect(kept.filter((count) => count > 0)).toHaveLength(2);
  });
});
