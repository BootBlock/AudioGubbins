import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree, memorySource } from '@audiogubbins/media-store/testing';
import {
  TreeFailure,
  TreeFailureKind,
  contentIdOf,
  stateFingerprintOf,
} from '@audiogubbins/project-format';

import { anotherProjectIn, type DirectoryWriter } from './project-directory.js';
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

const README = new TextEncoder().encode('Kept beside the tree.');

describe('exporting into a folder that holds a project', () => {
  it('refuses a folder holding another project, and changes nothing in it unasked', async () => {
    const { test, storage, project } = await changedProject();
    const other = await madeProject(test, storage.tree);
    const folder = new MemoryDirectory();
    expectSuccess(await exportUnpacked(other.id, folder, WHOLE, storage.exporting));
    folder.files.set('README.md', README);
    const before = new Map(folder.files);

    const refused = await exportUnpacked(project, folder, WHOLE, storage.exporting);

    expect(expectFailureCode(refused)).toBe('storage.folder-holds-another-project');
    expect(refused.ok ? undefined : anotherProjectIn(refused.failures[0])).toEqual({
      name: other.name,
    });
    expect(folder.files).toEqual(before);
  });

  it('replaces the other project only where the person confirmed it, keeping files beside it', async () => {
    const { test, storage, project } = await changedProject();
    const other = await madeProject(test, storage.tree);
    const folder = new MemoryDirectory();
    expectSuccess(await exportUnpacked(other.id, folder, WHOLE, storage.exporting));
    folder.files.set('README.md', README);
    const alone = new MemoryDirectory();
    expectSuccess(await exportUnpacked(project, alone, WHOLE, storage.exporting));

    const replacing = { ...WHOLE, replaceAnother: true };
    const attempt = expectSuccess(
      await exportUnpacked(project, folder, replacing, storage.exporting),
    );

    expectSuccess(attempt.written);
    // Every file of the other project's tree has gone, and the file beside it stays.
    expect([...folder.files.keys()].sort()).toEqual([...alone.files.keys(), 'README.md'].sort());
    expect(folder.files.get('README.md')).toEqual(README);
  });

  it('writes again, unasked, into a folder holding the same project', async () => {
    const { storage, project } = await changedProject();
    const folder = new MemoryDirectory();
    expectSuccess(await exportUnpacked(project, folder, WHOLE, storage.exporting));

    const again = expectSuccess(await exportUnpacked(project, folder, WHOLE, storage.exporting));

    expectSuccess(again.written);
  });

  it('refuses a folder holding project files whose header cannot be read', async () => {
    const { storage, project } = await changedProject();
    const folder = new MemoryDirectory();
    folder.files.set('audiogubbins-project.json', new TextEncoder().encode('{ not json'));

    const refused = await exportUnpacked(project, folder, WHOLE, storage.exporting);

    expect(refused.ok ? undefined : anotherProjectIn(refused.failures[0])).toEqual({
      name: undefined,
    });
  });
});

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
    expect(attempt.partial).toBe(true);
  });

  it('says nothing is partial where a folder export fails before it writes anything', async () => {
    const { storage, project } = await changedProject();
    const folder = new MemoryDirectory();
    const full: DirectoryWriter = {
      list: () => folder.list(),
      open: (path) => folder.open(path),
      remove: (path) => folder.remove(path),
      create: () => Promise.reject(new TreeFailure(TreeFailureKind.Quota, 'The disk is full.')),
    };

    const attempt = expectSuccess(await exportUnpacked(project, full, WHOLE, storage.exporting));

    expect(expectFailureCode(attempt.written)).toBe('storage.full');
    expect(attempt.partial).toBeUndefined();
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
