import { describe, expect, it } from 'vitest';

import type { ProjectId } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import { Turns } from '@audiogubbins/project-format';
import { immediateTurns } from '@audiogubbins/project-format/testing';

import { BackupGenerations } from './backup-generations.js';
import { restoreBackup } from './backup-restoring.js';
import { CheckedRecords } from './checked-records.js';
import { readProjectCopy } from './project-copy.js';
import { ProjectFiles } from './project-files.js';
import { openProject } from './project-opening.js';
import { summaryOf } from './testing/model-summary.js';
import { harness, nodeDigest } from './testing/node-services.js';
import { WINDOW_B, madeProject, openToWrite } from './testing/storage-harness.js';
import { setName } from './testing/test-commands.js';

/**
 * Restoring a backup generation (REQ-STOR-105, REQ-STOR-198): as a project of
 * its own, leaving the one it was made of alone; or in place, only once the
 * project as it was is kept as a protected generation, which brings it back,
 * since the replacement is no change the history can undo.
 */

/** A closed project with a generation made after 'Backed up', and a change after it. */
async function backedUp() {
  const test = harness(12);
  const tree = new MemoryStorageTree();
  const header = await madeProject(test, tree);
  const session = await openToWrite(test, tree, header.id);
  expectSuccess(await session.run(setName('Backed up')));
  expectSuccess(await session.checkpoint());
  const files = new ProjectFiles(new CheckedRecords(tree, nodeDigest), header.id);
  const generations = new BackupGenerations(tree, nodeDigest, header.id);
  const copy = expectSuccess(await readProjectCopy(files, test.services(tree)));
  const made = expectSuccess(
    await generations.create(
      copy,
      { reason: 'manual', at: test.clock.now(), protect: false },
      new Turns(immediateTurns),
    ),
  );
  const backedUpSummary = summaryOf(session.getSnapshot().model);
  expectSuccess(await session.run(setName('After the backup')));
  expectSuccess(await session.close());
  return { test, tree, header, generations, generation: made.number, backedUpSummary };
}

async function nameIn(
  test: ReturnType<typeof harness>,
  tree: MemoryStorageTree,
  project: ProjectId,
) {
  const opened = expectSuccess(await openProject({ project, access: 'read' }, test.services(tree)));
  return opened.kind === 'read-only' ? opened.view.getSnapshot().model : undefined;
}

describe('restoring a backup generation', () => {
  it('as a new project, with its history, leaving the project it was made of alone', async () => {
    const { test, tree, header, generation } = await backedUp();
    const restored = expectSuccess(
      await restoreBackup(header.id, generation, { as: 'new-project' }, test.services(tree)),
    );
    if (restored.kind !== 'new-project') throw new Error('Expected a new project.');
    expect(restored.header.id).not.toBe(header.id);

    const made = await nameIn(test, tree, restored.header.id);
    expect(made?.state.project.displayName).toBe('Backed up');
    expect(made?.state.project.id).toBe(restored.header.id);
    expect(made?.history.nodes.size).toBe(2);
    expect((await nameIn(test, tree, header.id))?.state.project.displayName).toBe(
      'After the backup',
    );
  });

  it('in place, keeping the project as it was as a protected generation that brings it back', async () => {
    const { test, tree, header, generations, generation, backedUpSummary } = await backedUp();
    const restored = expectSuccess(
      await restoreBackup(header.id, generation, { as: 'replace-current' }, test.services(tree)),
    );
    if (restored.kind !== 'replaced') throw new Error('Expected the project replaced.');
    expect(restored.saved).toEqual({ kind: 'written' });
    expect(restored.previous.protected).toBe(true);
    expect(summaryOf(restored.session.getSnapshot().model)).toBe(backedUpSummary);
    expectSuccess(await restored.session.close());
    expect((await nameIn(test, tree, header.id))?.state.project.displayName).toBe('Backed up');

    const previous = expectSuccess(await generations.copyOf(restored.previous.number));
    expect(previous.model.state.project.displayName).toBe('After the backup');
    const back = expectSuccess(
      await restoreBackup(
        header.id,
        restored.previous.number,
        { as: 'replace-current' },
        test.services(tree),
      ),
    );
    if (back.kind !== 'replaced') throw new Error('Expected the project replaced.');
    expect(back.session.getSnapshot().model.state.project.displayName).toBe('After the backup');
  });

  it('in place, refuses a project another window writes, keeping no generation for it', async () => {
    const { test, tree, header, generations, generation } = await backedUp();
    const other = await openToWrite(test, tree, header.id, { owner: WINDOW_B });
    const before = expectSuccess(await generations.list());
    expect(
      expectFailureCode(
        await restoreBackup(header.id, generation, { as: 'replace-current' }, test.services(tree)),
      ),
    ).toBe('storage.project-busy');
    expect(expectSuccess(await generations.list())).toEqual(before);
    expect(other.getSnapshot().model.state.project.displayName).toBe('After the backup');
  });
});
