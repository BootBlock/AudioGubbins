import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { withStateFingerprint } from '@audiogubbins/history';
import { MemoryStorageTree, nodeDigest } from '@audiogubbins/media-store/testing';

import { CheckedRecords } from './checked-records.js';
import { writeCheckpointAndHead } from './checkpoint-writing.js';
import { readPair, writeNext } from './generational-pair.js';
import { writeHead } from './project-heads.js';
import { openProject } from './project-opening.js';
import { ProjectFiles } from './project-files.js';
import { setName } from './testing/test-commands.js';
import { WINDOW_B, harness, madeProject, openToWrite } from './testing/storage-harness.js';

/**
 * A writer that lost the project without yet hearing of it moves nothing: its
 * checkpoint may be written, but not the head, and a head written late all the
 * same is fenced by the seal of its epoch (REQ-STOR-098).
 */
describe('a late writer moves no head', () => {
  it('refuses to write a head under an epoch no longer current', async () => {
    const test = harness();
    const tree = new MemoryStorageTree();
    const header = await madeProject(test, tree);
    const a = await openToWrite(test, tree, header.id);
    expectSuccess(await a.run(setName('A')));
    const files = new ProjectFiles(new CheckedRecords(tree, nodeDigest), header.id);
    const heads = await readPair(files.records, files.heads);

    const written = await writeCheckpointAndHead(files, {
      id: test.ids.next<'CheckpointId'>(),
      model: a.getSnapshot().model,
      position: { epoch: 1, sequence: 1 },
      leaseEpoch: 0,
      unwritten: new Map(),
    });
    expect(expectFailureCode(written)).toBe('storage.lease-superseded');
    expect(await readPair(files.records, files.heads)).toEqual(heads);
  });

  it('passes over a head written past its epoch’s seal', async () => {
    const test = harness();
    const tree = new MemoryStorageTree();
    const header = await madeProject(test, tree);
    const a = await openToWrite(test, tree, header.id);
    expectSuccess(await a.run(setName('A')));
    expectSuccess(await a.run(setName('A again')));
    const late = a.getSnapshot().model;
    const files = new ProjectFiles(new CheckedRecords(tree, nodeDigest), header.id);

    // B takes the project when A had written one record; A's second record and
    // a head of it land after, as if late.
    await tree.remove(files.paths.record(1, 2));
    const b = expectSuccess(
      await openProject(
        { project: header.id, access: 'write', steal: true },
        test.services(tree, { owner: WINDOW_B }),
      ),
    );
    if (b.kind !== 'writable') throw new Error('Expected B to write.');
    const checkpoint = test.ids.next<'CheckpointId'>();
    const cursorState = await files.states.put(late.state);
    const history = expectSuccess(
      withStateFingerprint(late.history, late.history.cursor, cursorState),
    );
    await files.writeCheckpoint(checkpoint, {
      history,
      cursorState,
      keptStates: new Set([cursorState]),
      exports: [],
      retention: late.retention,
      backup: late.backup,
      leaseEpoch: 1,
    });
    expectSuccess(
      await writeNext(
        files.records,
        files.heads,
        await readPair(files.records, files.heads),
        (generation) => writeHead({ generation, checkpoint, journal: { epoch: 1, sequence: 2 } }),
      ),
    );

    const read = expectSuccess(
      await openProject({ project: header.id, access: 'read' }, harness(50).services(tree)),
    );
    expect(read.report.fallbacks).toMatchObject([{ reason: { kind: 'head-fenced' } }]);
    const view = read.kind === 'read-only' ? read.view.getSnapshot() : undefined;
    expect(view?.model.state.project.displayName).toBe('A');
  });
});
