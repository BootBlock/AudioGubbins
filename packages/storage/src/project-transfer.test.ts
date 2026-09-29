import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree, memorySource } from '@audiogubbins/media-store/testing';
import {
  TreeFailure,
  TreeFailureKind,
  contentIdOf,
  stateFingerprintOf,
} from '@audiogubbins/project-format';

import type { DirectoryWriter } from './project-directory.js';
import { exportBundle, exportUnpacked } from './project-transfer.js';
import { MemoryDirectory, memorySink, storageOf, storedMedia } from './testing/memory-ports.js';
import { madeProject, openToWrite } from './testing/storage-harness.js';
import { addAsset, setName } from './testing/test-commands.js';
import { harness, nodeDigest } from './testing/node-services.js';

/**
 * What an export answers for its provenance (REQ-STOR-197, REQ-STOR-198): the
 * state and the history node it was taken from, as read from storage, and how
 * its writing went, a failure included, with the identity of a bundle's bytes.
 * Only the window writing a project can record the export, so these are what
 * it records from.
 */

const WHOLE = { scope: { kind: 'whole-history' }, includeCaches: false } as const;

/** A project with media and a change, open to write, and its storage. */
async function changedProject() {
  const test = harness(71);
  const storage = storageOf(test, new MemoryStorageTree());
  const media = await storedMedia(storage.store, 71);
  const header = await madeProject(test, storage.tree);
  const session = await openToWrite(test, storage.tree, header.id);
  expectSuccess(await session.run(addAsset(test.ids.next<'AssetId'>(), media)));
  expectSuccess(await session.run(setName('Exported')));
  expectSuccess(await session.run(setName('Changed again')));
  expectSuccess(await session.undo());
  return { test, storage, project: header.id, session };
}

describe('the provenance an export answers', () => {
  it('says which state and node a bundle was taken from, and the identity of its bytes', async () => {
    const { storage, project, session } = await changedProject();
    const { model } = session.getSnapshot();
    const sink = memorySink();

    const attempt = expectSuccess(await exportBundle(project, sink, WHOLE, storage.exporting));

    // The cursor after the undo, not the newest node, which is a state the
    // bundle's own project is not in.
    expect(attempt.source).toEqual({
      state: await stateFingerprintOf(model.state, nodeDigest),
      node: model.history.cursor,
    });
    const written = expectSuccess(attempt.written);
    expect(written.output).toEqual(
      expectSuccess(await contentIdOf(memorySource(sink.bytes()), nodeDigest)),
    );
    expect(written.output.byteLength).toBe(written.written.bytes);
  });

  it('says what a folder export was taken from when its writing fails part of the way', async () => {
    const { storage, project, session } = await changedProject();
    const { model } = session.getSnapshot();
    const folder = new MemoryDirectory();
    let created = 0;
    const filling: DirectoryWriter = {
      list: () => folder.list(),
      open: (path) => folder.open(path),
      remove: (path) => folder.remove(path),
      create: async (path) => {
        created += 1;
        if (created > 2) throw new TreeFailure(TreeFailureKind.Quota, 'The disk is full.');
        return await folder.create(path);
      },
    };

    const attempt = expectSuccess(await exportUnpacked(project, filling, WHOLE, storage.exporting));

    expect(attempt.source.node).toBe(model.history.cursor);
    expect(expectFailureCode(attempt.written)).toBe('storage.full');
    // What was written before the failure stays, which the provenance says.
    expect(folder.files.size).toBe(2);
  });

  it('answers only a failure, with nothing written, where the project cannot be read', async () => {
    const { storage } = await changedProject();
    const sink = memorySink();

    const missing = await exportBundle(
      harness(72).ids.next<'ProjectId'>(),
      sink,
      WHOLE,
      storage.exporting,
    );

    expect(expectFailureCode(missing)).toBe('storage.project-missing');
    expect(sink.ending).toBe('aborted');
  });
});
