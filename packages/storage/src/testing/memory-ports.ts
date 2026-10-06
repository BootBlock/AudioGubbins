/**
 * The ports a project is taken out through and brought in from, in memory: a
 * sink that keeps what it is given, a directory of files, and a storage with
 * its media store and caches, all over one tree, for the tests of bundles,
 * unpacked trees, backups and cleanup.
 */

import { succeed } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { MediaObjectStore } from '@audiogubbins/media-store';
import { countingTokens, generatedSource, memorySource } from '@audiogubbins/media-store/testing';
import type {
  ByteSink,
  ByteSource,
  ContentId,
  StorageTree,
  YieldToHost,
} from '@audiogubbins/project-format';

import { CacheStore } from '../cache-store.js';
import type { CleanupRunServices } from '../cleanup-running.js';
import { ModelPackStore } from '../model-pack-store.js';
import type { PackPins } from '../pack-cleanup.js';
import { mediaSharingOf } from '../storage-sharing.js';
import type { DirectoryFile, DirectoryWriter } from '../project-directory.js';
import type { ExportServices } from '../project-transfer.js';
import type { ImportServices } from '../tree-import.js';
import type { UsageServices } from '../usage-measurement.js';
import type { Harness } from './storage-harness.js';
import { TEST_INVOCATION_PROVENANCE } from './test-commands.js';

/** A sink that keeps every chunk, and says how it ended. */
export interface MemorySink extends ByteSink {
  readonly ending: 'open' | 'closed' | 'aborted';
  bytes(): Uint8Array<ArrayBuffer>;
}

export function memorySink(): MemorySink {
  const chunks: Uint8Array[] = [];
  let ending: MemorySink['ending'] = 'open';
  return {
    get ending() {
      return ending;
    },
    write: (chunk) => {
      if (ending !== 'open') throw new Error(`The sink is ${ending}.`);
      chunks.push(chunk.slice());
      return Promise.resolve();
    },
    close: () => {
      ending = 'closed';
      return Promise.resolve();
    },
    abort: () => {
      ending = 'aborted';
      return Promise.resolve();
    },
    bytes: () => {
      const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
      let at = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, at);
        at += chunk.length;
      }
      return bytes;
    },
  };
}

/** A directory of files in memory. */
export class MemoryDirectory implements DirectoryWriter {
  readonly files = new Map<string, Uint8Array<ArrayBuffer>>();

  list(): Promise<readonly DirectoryFile[]> {
    return Promise.resolve([...this.files].map(([path, bytes]) => ({ path, size: bytes.length })));
  }

  open(path: string): Promise<ByteSource | undefined> {
    const bytes = this.files.get(path);
    return Promise.resolve(bytes === undefined ? undefined : memorySource(bytes));
  }

  create(path: string): Promise<ByteSink> {
    const sink = memorySink();
    return Promise.resolve({
      write: async (chunk) => {
        await sink.write(chunk);
      },
      close: async () => {
        await sink.close();
        this.files.set(path, sink.bytes());
      },
      abort: async () => {
        await sink.abort();
      },
    });
  }

  remove(path: string): Promise<void> {
    this.files.delete(path);
    return Promise.resolve();
  }
}

/** A storage over one tree: its media store and caches, and the services over them. */
export interface TestStorage {
  readonly tree: StorageTree;
  readonly store: MediaObjectStore;
  readonly caches: CacheStore;
  readonly packs: ModelPackStore;
  readonly exporting: ExportServices;
  readonly measuring: UsageServices;
  readonly importing: ImportServices;
  readonly cleaning: CleanupRunServices;
}

/** Pins no pack version: no project of a test needs one unless it says so. */
const NO_PINS: PackPins = () => Promise.resolve(succeed([]));

/**
 * The storage of one window of a test over a tree, whose long work asks
 * `yieldToHost` for its turns where it is given.
 */
export function storageOf(
  test: Harness,
  tree: StorageTree,
  yieldToHost?: YieldToHost,
): TestStorage {
  const { digest } = test;
  const store = new MediaObjectStore({
    tree,
    root: 'media',
    digest,
    nextToken: countingTokens(),
    sharing: mediaSharingOf(test.coordinator),
  });
  const caches = new CacheStore(tree, digest);
  const packs = new ModelPackStore(tree, digest, test.coordinator);
  const services = test.services(tree, yieldToHost === undefined ? {} : { yieldToHost });
  return {
    tree,
    store,
    caches,
    packs,
    exporting: { ...services, store, caches, invocationProvenance: TEST_INVOCATION_PROVENANCE },
    measuring: { ...services, store, caches, packs },
    cleaning: { ...services, store, caches, packs, packPins: NO_PINS },
    importing: {
      tree,
      digest,
      invocationProvenance: TEST_INVOCATION_PROVENANCE,
      clock: test.clock,
      ids: test.ids,
      store,
      caches,
      coordinator: test.coordinator,
      owner: services.owner,
      yieldToHost: services.yieldToHost,
    },
  };
}

/** Keeps `size` generated bytes in a store and gives their identity, held by nothing. */
export async function storedMedia(
  store: MediaObjectStore,
  seed: number,
  size = 3_000,
): Promise<ContentId> {
  const { contentId } = expectSuccess(await store.put(generatedSource(size, seed)));
  store.release(contentId);
  return contentId;
}
