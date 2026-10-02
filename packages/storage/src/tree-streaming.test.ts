import { describe, expect, it } from 'vitest';

import type { ProjectId } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import {
  Turns,
  type ByteSink,
  type ByteSource,
  type StorageTree,
  type TreeEntry,
} from '@audiogubbins/project-format';
import { immediateTurns } from '@audiogubbins/project-format/testing';

import { BackupGenerations } from './backup-generations.js';
import { restoreBackup } from './backup-restoring.js';
import { CheckedRecords } from './checked-records.js';
import { readProjectCopy } from './project-copy.js';
import { ProjectFiles } from './project-files.js';
import { exportBundle, exportUnpacked, importUnpacked } from './project-transfer.js';
import { MemoryDirectory, memorySink, storageOf } from './testing/memory-ports.js';
import { madeProject, openToWrite, type Harness } from './testing/storage-harness.js';
import { setName } from './testing/test-commands.js';
import { harness, nodeDigest } from './testing/node-services.js';

/**
 * A whole history taken out, brought in or restored holds one kept state at a
 * time (REQ-EXEC-216): a history may keep more states than fit in memory, so
 * each is read only as it is written. Counted through the ports the states
 * pass through: how many were read, at the most, before anything was written.
 */

const WHOLE = { scope: { kind: 'whole-history' }, includeCaches: false } as const;

/** How many kept states have been read since anything was last written, at the most. */
class Holding {
  peak = 0;
  #held = 0;

  read(): void {
    this.#held += 1;
    this.peak = Math.max(this.peak, this.#held);
  }

  wrote(): void {
    this.#held = 0;
  }
}

const STATE_FILE = /\/states\/s1-[0-9a-f]{64}\.json$/u;

/**
 * A tree that tells `holding` of every write, and of each read of a kept state:
 * one `readFrom` accepts the path of is read from where the states come from,
 * and any other is a store checking whether it holds a state it is given, which
 * it has then taken, written or found kept already.
 */
class HoldingTree implements StorageTree {
  readonly #inner: StorageTree;
  readonly #holding: Holding;
  readonly #readFrom: (path: string) => boolean;

  constructor(
    inner: StorageTree,
    holding: Holding,
    readFrom: (path: string) => boolean = () => true,
  ) {
    this.#inner = inner;
    this.#holding = holding;
    this.#readFrom = readFrom;
  }

  async readFile(path: string, signal?: AbortSignal) {
    if (STATE_FILE.test(path)) {
      if (this.#readFrom(path)) this.#holding.read();
      else this.#holding.wrote();
    }
    return await this.#inner.readFile(path, signal);
  }

  async openFile(path: string): Promise<ByteSource | undefined> {
    return await this.#inner.openFile(path);
  }

  async writeFile(path: string, bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
    this.#holding.wrote();
    await this.#inner.writeFile(path, bytes, signal);
  }

  async createFile(path: string): Promise<ByteSink> {
    this.#holding.wrote();
    return await this.#inner.createFile(path);
  }

  async remove(path: string): Promise<void> {
    await this.#inner.remove(path);
  }

  async list(directory: string): Promise<readonly TreeEntry[]> {
    return await this.#inner.list(directory);
  }
}

/** A directory that tells `holding` of each kept state read from it, and of every write. */
class HoldingDirectory extends MemoryDirectory {
  readonly #holding: Holding;

  constructor(holding: Holding, from?: MemoryDirectory) {
    super();
    this.#holding = holding;
    for (const [path, bytes] of from?.files ?? []) this.files.set(path, bytes);
  }

  override async open(path: string): Promise<ByteSource | undefined> {
    if (STATE_FILE.test(path)) this.#holding.read();
    return await super.open(path);
  }

  override async create(path: string): Promise<ByteSink> {
    this.#holding.wrote();
    return await super.create(path);
  }
}

/** A closed project whose history keeps a state after each of its changes. */
async function longHistory(test: Harness, tree: MemoryStorageTree) {
  const header = await madeProject(test, tree);
  const session = await openToWrite(test, tree, header.id, {
    cadence: { checkpointAfter: 4, keepStateEvery: 1 },
  });
  for (let take = 1; take <= 16; take += 1) {
    expectSuccess(await session.run(setName(`Take ${String(take)}`)));
  }
  expectSuccess(await session.close());
  const kept = tree.paths().filter((path) => STATE_FILE.test(path)).length;
  expect(kept).toBeGreaterThanOrEqual(8);
  return header.id;
}

async function unpacked(test: Harness, tree: MemoryStorageTree, project: ProjectId) {
  const directory = new MemoryDirectory();
  const attempt = expectSuccess(
    await exportUnpacked(project, directory, WHOLE, storageOf(test, tree).exporting),
  );
  expectSuccess(attempt.written);
  return directory;
}

describe('a whole history holds one kept state at a time', () => {
  it('as it is written to a folder', async () => {
    const test = harness(401);
    const tree = new MemoryStorageTree();
    const project = await longHistory(test, tree);
    const holding = new Holding();
    const source = storageOf(test, new HoldingTree(tree, holding));

    const attempt = expectSuccess(
      await exportUnpacked(project, new HoldingDirectory(holding), WHOLE, source.exporting),
    );

    expectSuccess(attempt.written);
    expect(holding.peak).toBeLessThanOrEqual(2);
  });

  it('as it is written as a bundle', async () => {
    const test = harness(402);
    const tree = new MemoryStorageTree();
    const project = await longHistory(test, tree);
    const holding = new Holding();
    const source = storageOf(test, new HoldingTree(tree, holding));
    const sink = memorySink();
    const counted: ByteSink = {
      write: async (chunk) => {
        holding.wrote();
        await sink.write(chunk);
      },
      close: async () => {
        await sink.close();
      },
      abort: async (reason) => {
        await sink.abort(reason);
      },
    };

    const attempt = expectSuccess(await exportBundle(project, counted, WHOLE, source.exporting));

    expectSuccess(attempt.written);
    expect(holding.peak).toBeLessThanOrEqual(2);
  });

  it.each(['original', 'copy'] as const)(
    'as it is brought in from a folder, as the %s',
    async (identity) => {
      const test = harness(403);
      const tree = new MemoryStorageTree();
      const project = await longHistory(test, tree);
      const holding = new Holding();
      const folder = new HoldingDirectory(holding, await unpacked(test, tree, project));
      const into = new HoldingTree(new MemoryStorageTree(), holding, () => false);
      const target = storageOf(harness(404), into);

      expectSuccess(await importUnpacked(folder, identity, target.importing));

      expect(holding.peak).toBeLessThanOrEqual(1);
    },
  );

  it.each(['new-project', 'replace-current'] as const)(
    'as a backup of it is restored, as %s',
    async (as) => {
      const test = harness(405);
      const tree = new MemoryStorageTree();
      const project = await longHistory(test, tree);
      const files = new ProjectFiles(new CheckedRecords(tree, nodeDigest), project);
      const copy = expectSuccess(await readProjectCopy(files, test.services(tree)));
      const generations = new BackupGenerations(tree, nodeDigest, project);
      const made = expectSuccess(
        await generations.create(
          copy,
          { reason: 'manual', at: test.clock.now(), protect: false },
          new Turns(immediateTurns),
          test.coordinator,
        ),
      );
      const holding = new Holding();
      const watched = new HoldingTree(tree, holding, (path) => path.startsWith('backups/'));

      const restored = expectSuccess(
        await restoreBackup(project, made.number, { as }, test.services(watched)),
      );

      if (restored.kind === 'replaced') expectSuccess(await restored.session.close());
      expect(holding.peak).toBeLessThanOrEqual(2);
    },
  );
});
