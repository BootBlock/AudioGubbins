/**
 * A `PackSource` over packs held in memory, for the installer's tests: it
 * records each read it is asked for, serves a file a few bytes at a time, and
 * can be told to break a transfer part way, to serve other bytes than a file's
 * own, or to call a test back after each chunk, so a test can pause or cancel a
 * transfer between two chunks.
 */

import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';

import { packKey, refOf, type ModelPackManifest } from '../manifest.js';
import {
  transferStopped,
  type FileRange,
  type PackSource,
  type ReceiveChunk,
} from '../pack-source.js';
import type { TestPack } from './node-sha256.js';

/** A read the source was asked for. */
export interface RecordedRead {
  readonly path: string;
  readonly offset: number;
}

/** How the source misbehaves. */
export interface SourceOptions {
  /** The bytes served at a time: 3 where not given. */
  readonly chunkBytes?: number;
  /** Breaks the next transfer of `path` once `afterBytes` of the file have been served. */
  readonly breakAt?: { readonly path: string; readonly afterBytes: number };
  /** Serves these bytes for a path in place of the file's own. */
  readonly serve?: ReadonlyMap<string, Uint8Array<ArrayBuffer>>;
  /** Called after each chunk is taken, with the file and the bytes of it served so far. */
  readonly afterChunk?: (path: string, served: number) => void;
}

/** Packs in memory as a source (see the module comment). */
export class MemorySource implements PackSource {
  readonly reads: RecordedRead[] = [];
  /** The most reads in flight at once. */
  mostAtOnce = 0;
  private inFlight = 0;
  private readonly packs: ReadonlyMap<string, TestPack>;
  private readonly options: SourceOptions;
  private broken = false;

  constructor(packs: readonly TestPack[], options: SourceOptions = {}) {
    this.packs = new Map(packs.map((pack) => [packKey(refOf(pack.manifest)), pack]));
    this.options = options;
  }

  catalogue(): Promise<DomainResult<readonly ModelPackManifest[]>> {
    return Promise.resolve(succeed([...this.packs.values()].map((pack) => pack.manifest)));
  }

  async read(
    range: FileRange,
    receive: ReceiveChunk,
    signal?: AbortSignal,
  ): Promise<DomainResult<void>> {
    const { path } = range.file;
    this.reads.push({ path, offset: range.offset });
    const bytes =
      this.options.serve?.get(path) ?? this.packs.get(packKey(refOf(range.pack)))?.files.get(path);
    if (bytes === undefined) throw new Error(`The test source holds no ${path}.`);
    this.inFlight += 1;
    this.mostAtOnce = Math.max(this.mostAtOnce, this.inFlight);
    try {
      const step = this.options.chunkBytes ?? 3;
      for (let offset = range.offset; offset < bytes.length; offset += step) {
        if (signal?.aborted === true) return transferStopped();
        const { breakAt } = this.options;
        if (breakAt?.path === path && offset >= breakAt.afterBytes && !this.broken) {
          this.broken = true;
          return fail(
            failure('model-pack.network-failed', FailureKind.Retryable, 'The test broke it.'),
          );
        }
        // A real source yields between chunks, as the network does.
        await Promise.resolve();
        const end = Math.min(offset + step, bytes.length);
        const taken = await receive(bytes.slice(offset, end));
        if (!taken.ok) return taken;
        this.options.afterChunk?.(path, end);
      }
      return signal?.aborted === true ? transferStopped() : succeed(undefined);
    } finally {
      this.inFlight -= 1;
    }
  }
}
