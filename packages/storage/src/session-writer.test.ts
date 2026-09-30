import { afterEach, describe, expect, it, vi } from 'vitest';

import { FailureKind, fail, failure } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';

import { CheckedRecords } from './checked-records.js';
import { readHeads } from './project-heads.js';
import { ProjectFiles } from './project-files.js';
import { recordTooLarge } from './storage-failures.js';
import { harness, nodeDigest } from './testing/node-services.js';
import { madeProject, openToWrite } from './testing/storage-harness.js';
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
