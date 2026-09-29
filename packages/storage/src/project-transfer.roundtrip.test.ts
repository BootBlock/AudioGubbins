import { describe, expect, it } from 'vitest';

import type { ProjectId } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree, memorySource, nodeDigest } from '@audiogubbins/media-store/testing';
import {
  ProvenanceLevel,
  contentIdOf,
  openZip,
  readVerified,
  writeZip,
  writeBundleManifest,
  type ContentId,
  type ManifestEntry,
  type StorageTree,
} from '@audiogubbins/project-format';
import { SCHEMA_VERSIONS } from '@audiogubbins/version';

import { packUnpacked, unpackBundle } from './bundle-conversion.js';
import { bytesSource } from './byte-streams.js';
import { openProject } from './project-opening.js';
import { exportBundle, exportUnpacked, importBundle, importUnpacked } from './project-transfer.js';
import { summaryOf } from './testing/model-summary.js';
import {
  MemoryDirectory,
  memorySink,
  storageOf,
  storedMedia,
  type TestStorage,
} from './testing/memory-ports.js';
import { randomStep } from './testing/random-sessions.js';
import type { CopyOptions } from './tree-content.js';
import { seededRandom } from './testing/seeded-random.js';
import { addAsset } from './testing/test-commands.js';
import { harness, madeProject, openToWrite, type Harness } from './testing/storage-harness.js';

/**
 * Bundles and unpacked trees round-trip (REQ-STOR-103, REQ-STOR-099): a project
 * made by a random session, taken out as a bundle and brought into another
 * storage, is the same project, with its state, its whole history, its
 * snapshots and its export log; a bundle unpacked and packed again is the same
 * bundle, byte for byte, and so is the tree the storage writes; and media is
 * kept once however many projects bring it in.
 */

const WHOLE = { scope: { kind: 'whole-history' }, includeCaches: false } as const;
const SEEDS = Array.from({ length: 12 }, (_, index) => index + 1);

/**
 * What a bundle carries of a project: everything but its backup policy, which
 * belongs to the storage it is kept in, and an open comparison, which belongs
 * to the window it was open in.
 */
function carried(summary: string): unknown {
  const {
    backup: _backup,
    comparison: _comparison,
    ...rest
  } = JSON.parse(summary) as Record<string, unknown>;
  return rest;
}

async function openedSummary(test: Harness, tree: StorageTree, project: ProjectId) {
  const opened = expectSuccess(await openProject({ project, access: 'read' }, test.services(tree)));
  if (opened.kind !== 'read-only') throw new Error('Expected the project to open read-only.');
  expect(opened.report.journalBreak).toBeUndefined();
  expect(opened.report.missingStates).toEqual([]);
  return summaryOf(opened.view.getSnapshot().model);
}

/** A project made by a random session of `steps`, over media the store holds. */
async function randomProject(test: Harness, storage: TestStorage, seed: number, steps = 40) {
  const media: ContentId[] = [];
  for (let index = 0; index < 10; index += 1)
    media.push(await storedMedia(storage.store, seed * 10 + index));
  const header = await madeProject(test, storage.tree);
  const session = await openToWrite(test, storage.tree, header.id, {
    cadence: { checkpointAfter: 5, keepStateEvery: 3 },
  });
  const run = {
    session,
    random: seededRandom(seed),
    test,
    media: (index: number) => media[index % media.length] ?? media[0] ?? storedMediaMissing(),
  };
  for (let step = 0; step < steps; step += 1) await randomStep(run, step);
  // A snapshot, so the bundle has a restore point to carry whatever the steps did.
  expectSuccess(await session.createSnapshot({ name: 'Kept', notes: 'For the client' }));
  const summary = summaryOf(session.getSnapshot().model);
  expectSuccess(await session.close());
  return { project: header.id, summary };
}

function storedMediaMissing(): never {
  throw new Error('No media was stored.');
}

async function bundleOf(storage: TestStorage, project: ProjectId, options: CopyOptions = WHOLE) {
  const sink = memorySink();
  expectSuccess(await exportBundle(project, sink, options, storage.exporting));
  expect(sink.ending).toBe('closed');
  return sink.bytes();
}

describe('bundles and unpacked trees round-trip (REQ-STOR-103)', () => {
  it.each(SEEDS)(
    'seed %i: a bundle brings the whole project into another storage',
    async (seed) => {
      const test = harness(seed);
      const source = storageOf(test, new MemoryStorageTree());
      const { project, summary } = await randomProject(test, source, seed);
      const bundle = await bundleOf(source, project);

      const other = harness(seed + 100);
      const target = storageOf(other, new MemoryStorageTree());
      const header = expectSuccess(
        await importBundle(memorySource(bundle), 'original', target.importing),
      );
      expect(header.id).toBe(project);
      expect(header.imported?.from).toBe(project);
      expect(carried(await openedSummary(other, target.tree, project))).toEqual(carried(summary));

      // Unpacked and packed again, the bundle is the same, byte for byte.
      const directory = new MemoryDirectory();
      expectSuccess(await unpackBundle(memorySource(bundle), directory, nodeDigest));
      const packed = memorySink();
      expectSuccess(await packUnpacked(directory, packed, nodeDigest));
      expect(packed.bytes()).toEqual(bundle);

      // The tree the storage writes is the tree the bundle holds.
      const written = new MemoryDirectory();
      expectSuccess(await exportUnpacked(project, written, WHOLE, source.exporting));
      expect([...written.files].sort()).toEqual([...directory.files].sort());

      // And a tree brings the project in as a bundle does.
      const third = harness(seed + 200);
      const fromTree = storageOf(third, new MemoryStorageTree());
      expectSuccess(await importUnpacked(written, 'original', fromTree.importing));
      expect(carried(await openedSummary(third, fromTree.tree, project))).toEqual(carried(summary));
    },
  );

  it('keeps media once however many projects bring it in, and refuses a second original', async () => {
    const test = harness(3);
    const source = storageOf(test, new MemoryStorageTree());
    const { project } = await randomProject(test, source, 3);
    const bundle = await bundleOf(source, project);

    const target = storageOf(harness(4), new MemoryStorageTree());
    expectSuccess(await importBundle(memorySource(bundle), 'original', target.importing));
    const objects = async () => {
      const held: ContentId[] = [];
      for await (const { contentId } of target.store.list()) held.push(contentId);
      return held;
    };
    const once = await objects();
    expect((await importBundle(memorySource(bundle), 'original', target.importing)).ok).toBe(false);
    const copy = expectSuccess(await importBundle(memorySource(bundle), 'copy', target.importing));
    expect(copy.id).not.toBe(project);
    expect(copy.imported?.from).toBe(project);
    expect(await objects()).toEqual(once);

    // The copy is a project of its own, with the same history.
    const [original, copied] = await Promise.all([
      openedSummary(harness(5), target.tree, project),
      openedSummary(harness(6), target.tree, copy.id),
    ]);
    const { nodes: originalNodes } = carried(original) as { nodes: unknown };
    const { nodes: copiedNodes } = carried(copied) as { nodes: unknown };
    expect(copiedNodes).toEqual(originalNodes);
  });

  it('carries every piece of media a project shares with another', async () => {
    const test = harness(7);
    const source = storageOf(test, new MemoryStorageTree());
    const shared = await storedMedia(source.store, 70);
    const projects: ProjectId[] = [];
    for (const name of ['First', 'Second']) {
      const header = await madeProject(test, source.tree, name);
      const session = await openToWrite(test, source.tree, header.id);
      expectSuccess(await session.run(addAsset(test.ids.next<'AssetId'>(), shared)));
      expectSuccess(await session.close());
      projects.push(header.id);
    }
    const [first] = projects;
    if (first === undefined) throw new Error('No project.');
    const bundle = await bundleOf(source, first, {
      scope: { kind: 'current-state', provenance: ProvenanceLevel.None },
      includeCaches: false,
    });

    const target = storageOf(harness(8), new MemoryStorageTree());
    expectSuccess(await importBundle(memorySource(bundle), 'original', target.importing));
    expect(expectSuccess(await target.store.find(shared))).toMatchObject({ contentId: shared });
    expectSuccess(await target.store.verify(shared));
  });

  it('exports the state alone, its history begun again as an import', async () => {
    const test = harness(9);
    const source = storageOf(test, new MemoryStorageTree());
    const { project } = await randomProject(test, source, 9, 20);
    const bundle = await bundleOf(source, project, {
      scope: { kind: 'current-state', provenance: ProvenanceLevel.Minimal },
      includeCaches: false,
    });
    const other = harness(10);
    const target = storageOf(other, new MemoryStorageTree());
    expectSuccess(await importBundle(memorySource(bundle), 'original', target.importing));
    const opened = expectSuccess(
      await openProject({ project, access: 'read' }, other.services(target.tree)),
    );
    if (opened.kind !== 'read-only') throw new Error('Expected read-only.');
    const { history } = opened.view.getSnapshot().model;
    expect(history.nodes.size).toBe(1);
    expect(history.nodes.get(history.root)).toMatchObject({ origin: { kind: 'import' } });
  });
});

/** The bundle's entries with `edit` applied, and a manifest made for them. */
async function rebuilt(
  bundle: Uint8Array<ArrayBuffer>,
  edit: (path: string, bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>,
  manifest: 'listing the edits' | 'as it was' = 'listing the edits',
): Promise<Uint8Array<ArrayBuffer>> {
  const archive = expectSuccess(await openZip(memorySource(bundle)));
  const files: { path: string; bytes: Uint8Array<ArrayBuffer> }[] = [];
  for (const entry of archive.entries) {
    const chunks: Uint8Array[] = [];
    expectSuccess(
      await readVerified(entry, (chunk) => {
        chunks.push(chunk.slice());
        return Promise.resolve();
      }),
    );
    const whole = new Uint8Array(entry.size);
    let at = 0;
    for (const chunk of chunks) {
      whole.set(chunk, at);
      at += chunk.length;
    }
    files.push({ path: entry.path, bytes: edit(entry.path, whole) });
  }
  const listed: ManifestEntry[] = [];
  for (const { path, bytes } of files) {
    if (path === 'manifest.json') continue;
    const { contentId } = expectSuccess(await contentIdOf(bytesSource(bytes), nodeDigest));
    listed.push({ path, size: bytes.length, contentId });
  }
  const sink = memorySink();
  expectSuccess(
    await writeZip(
      files.map(({ path, bytes }) => ({
        path,
        source:
          path === 'manifest.json' && manifest === 'listing the edits'
            ? edit(path, writeBundleManifest(listed))
            : bytes,
      })),
      sink,
    ),
  );
  return sink.bytes();
}

function editedJson(bytes: Uint8Array, change: (value: Record<string, unknown>) => unknown) {
  const value = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  return new TextEncoder().encode(JSON.stringify(change(value)));
}

describe('an unpacked tree in a directory the person keeps (REQ-STOR-103)', () => {
  it('removes the files a project no longer has, and leaves everything else alone', async () => {
    const test = harness(30);
    const storage = storageOf(test, new MemoryStorageTree());
    const media = await storedMedia(storage.store, 300);
    const header = await madeProject(test, storage.tree);
    const session = await openToWrite(test, storage.tree, header.id);
    expectSuccess(await session.run(addAsset(test.ids.next<'AssetId'>(), media)));
    const directory = new MemoryDirectory();
    directory.files.set('.git/HEAD', new TextEncoder().encode('ref: main'));
    directory.files.set('notes/readme.txt', new TextEncoder().encode('Our notes.'));
    expectSuccess(await exportUnpacked(header.id, directory, WHOLE, storage.exporting));
    const assetFiles = () =>
      [...directory.files.keys()].filter((path) => path.startsWith('project/assets/'));
    expect(assetFiles()).toHaveLength(2);

    expectSuccess(await session.undo());
    expectSuccess(
      await exportUnpacked(
        header.id,
        directory,
        {
          scope: { kind: 'current-state', provenance: ProvenanceLevel.Full },
          includeCaches: false,
        },
        storage.exporting,
      ),
    );
    expect(assetFiles()).toEqual([]);
    expect([...directory.files.keys()].some((path) => path.startsWith('history/'))).toBe(false);
    expect(directory.files.has('.git/HEAD')).toBe(true);
    expect(directory.files.has('notes/readme.txt')).toBe(true);

    // What lies beside the tree is none of the project's; what lies in it is.
    const other = storageOf(harness(31), new MemoryStorageTree());
    expectSuccess(await importUnpacked(directory, 'original', other.importing));
    directory.files.set('project/notes.json', new TextEncoder().encode('{}'));
    const refused = await importUnpacked(directory, 'copy', other.importing);
    expect(refused.ok).toBe(false);
  });
});

describe('bringing in a bundle refuses what it cannot trust (REQ-STOR-052)', () => {
  async function sampleBundle() {
    const test = harness(21);
    const source = storageOf(test, new MemoryStorageTree());
    const { project } = await randomProject(test, source, 21, 15);
    return await bundleOf(source, project);
  }

  it('refuses a bundle of another schema, naming its version, and writes nothing', async () => {
    const newer = SCHEMA_VERSIONS.portableBundle + 1;
    for (const at of ['manifest.json', 'audiogubbins-project.json']) {
      const bundle = await rebuilt(await sampleBundle(), (path, bytes) =>
        path === at ? editedJson(bytes, (value) => ({ ...value, schemaVersion: newer })) : bytes,
      );
      const target = storageOf(harness(22), new MemoryStorageTree());
      const imported = await importBundle(memorySource(bundle), 'original', target.importing);
      expect(imported.ok).toBe(false);
      if (imported.ok) return;
      expect(imported.failures[0]).toMatchObject({
        code: 'format.schema-incompatible',
        details: { schema: 'portableBundle', found: newer },
      });
      expect((target.tree as MemoryStorageTree).paths()).toEqual([]);
    }
  });

  it('refuses media that is not what its name says, and leaves no project', async () => {
    const bundle = await rebuilt(await sampleBundle(), (path, bytes) => {
      if (!path.startsWith('media/')) return bytes;
      const changed = bytes.slice();
      changed[0] = (changed[0] ?? 0) ^ 0xff;
      return changed;
    });
    const test = harness(23);
    const target = storageOf(test, new MemoryStorageTree());
    const imported = await importBundle(memorySource(bundle), 'original', target.importing);
    expect(imported.ok).toBe(false);
    const listed = [];
    for await (const entry of test.repository(target.tree).list()) listed.push(entry);
    expect(listed).toEqual([]);
  });

  it('refuses an entry that is not the content its manifest lists', async () => {
    const bundle = await rebuilt(
      await sampleBundle(),
      (path, bytes) =>
        path === 'audiogubbins-project.json'
          ? new TextEncoder().encode(
              new TextDecoder().decode(bytes).replace('project-tree', 'project-trex'),
            )
          : bytes,
      'as it was',
    );
    const target = storageOf(harness(25), new MemoryStorageTree());
    const imported = await importBundle(memorySource(bundle), 'original', target.importing);
    expect(imported.ok).toBe(false);
    if (imported.ok) return;
    expect(imported.failures[0].code).toBe('bundle.entry-damaged');
  });

  it('refuses an archive holding what its manifest does not list', async () => {
    const bundle = await sampleBundle();
    const archive = expectSuccess(await openZip(memorySource(bundle)));
    const sink = memorySink();
    const entries = [];
    for (const entry of archive.entries) {
      entries.push({ path: entry.path, source: expectSuccess(await entry.open()) });
    }
    entries.push({ path: 'project/extra.json', source: new TextEncoder().encode('{}') });
    expectSuccess(await writeZip(entries, sink));
    const target = storageOf(harness(24), new MemoryStorageTree());
    const imported = await importBundle(memorySource(sink.bytes()), 'original', target.importing);
    expect(imported.ok).toBe(false);
    if (imported.ok) return;
    expect(imported.failures[0].code).toBe('bundle.unlisted-entry');
  });
});
