/**
 * A `PackStore` held in memory, for the installer's tests, held to the same
 * contract as the storage's (`store-contract.ts`).
 *
 * Faithful where the installer depends on it: a file's bytes are kept as a sink
 * writes them, a closed run stays kept and an aborted one does not, and a write
 * past `quotaBytes` across every file is refused, before any of its bytes are
 * kept, with the tree's `quota` failure. A test can also flip a kept byte, as a
 * disk that rots would.
 */

import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';
import {
  TreeFailure,
  TreeFailureKind,
  type ByteSink,
  type ByteSource,
} from '@audiogubbins/project-format';

import { packKey, type ModelPackManifest, type PackRef } from '../manifest.js';
import { manifestJson } from '../manifest-writing.js';
import type { KeptPack, PackStore } from '../pack-store.js';

/** One file's bytes, kept from the start without a gap. */
class KeptBytes {
  bytes = new Uint8Array(0);
  length = 0;

  append(chunk: Uint8Array): void {
    if (this.length + chunk.length > this.bytes.length) {
      const grown = new Uint8Array(Math.max(this.length + chunk.length, this.bytes.length * 2));
      grown.set(this.bytes.subarray(0, this.length));
      this.bytes = grown;
    }
    this.bytes.set(chunk, this.length);
    this.length += chunk.length;
  }
}

interface Version {
  readonly manifest: ModelPackManifest;
  readonly files: Map<number, KeptBytes>;
  sealed: boolean;
}

/** What the store may be told to refuse. */
export interface MemoryStoreOptions {
  /** The most bytes the store keeps, across every file. */
  readonly quotaBytes?: number;
}

function sameManifest(one: ModelPackManifest, other: ModelPackManifest): boolean {
  return JSON.stringify(manifestJson(one)) === JSON.stringify(manifestJson(other));
}

function notStaged(ref: PackRef): DomainResult<never> {
  return fail(
    failure('model-pack.not-staged', FailureKind.Conflict, `${packKey(ref)} is not staged.`),
  );
}

/** A pack store in memory (see the module comment). */
export class MemoryPackStore implements PackStore {
  private readonly versions = new Map<string, Version>();
  private readonly options: MemoryStoreOptions;

  constructor(options: MemoryStoreOptions = {}) {
    this.options = options;
  }

  /** Flips the bits of the kept byte at `at` of a file, as a disk that rots would. */
  rot(ref: PackRef, index: number, at: number): void {
    const file = this.versions.get(packKey(ref))?.files.get(index);
    if (file === undefined || at >= file.length) throw new RangeError('No such byte is kept.');
    file.bytes[at] = (file.bytes[at] ?? 0) ^ 0xff;
  }

  /** Every byte the store keeps. */
  heldBytes(): number {
    let held = 0;
    for (const version of this.versions.values()) {
      for (const file of version.files.values()) held += file.length;
    }
    return held;
  }

  kept(): Promise<DomainResult<readonly KeptPack[]>> {
    const kept = [...this.versions.values()]
      .sort((one, other) => {
        const left = one.manifest;
        const right = other.manifest;
        if (left.id !== right.id) return left.id < right.id ? -1 : 1;
        return left.version < right.version ? -1 : left.version > right.version ? 1 : 0;
      })
      .map((version): KeptPack => {
        if (version.sealed) return { kind: 'sealed', manifest: version.manifest };
        let received = 0;
        for (const [index, file] of version.manifest.files.entries()) {
          received += Math.min(version.files.get(index)?.length ?? 0, file.bytes);
        }
        return { kind: 'staged', manifest: version.manifest, received };
      });
    return Promise.resolve(succeed(kept));
  }

  stage(manifest: ModelPackManifest): Promise<DomainResult<void>> {
    const key = packKey({ id: manifest.id, version: manifest.version });
    const held = this.versions.get(key);
    if (held?.sealed === true) {
      return Promise.resolve(
        fail(
          failure(
            'model-pack.already-sealed',
            FailureKind.Conflict,
            `${key} is installed; only its removal changes it.`,
          ),
        ),
      );
    }
    if (held === undefined || !sameManifest(held.manifest, manifest)) {
      this.versions.set(key, { manifest, files: new Map(), sealed: false });
    }
    return Promise.resolve(succeed(undefined));
  }

  stagedBytes(ref: PackRef, index: number): Promise<DomainResult<number>> {
    const version = this.versions.get(packKey(ref));
    if (version === undefined || version.sealed) return Promise.resolve(notStaged(ref));
    return Promise.resolve(succeed(version.files.get(index)?.length ?? 0));
  }

  append(ref: PackRef, index: number): Promise<DomainResult<ByteSink>> {
    const version = this.versions.get(packKey(ref));
    if (version === undefined || version.sealed) return Promise.resolve(notStaged(ref));
    const file = version.files.get(index) ?? new KeptBytes();
    version.files.set(index, file);
    const offset = file.length;
    let open = true;
    const whileOpen = (): void => {
      if (!open) throw new Error('A sink cannot be used once it is closed or aborted.');
    };
    const sink: ByteSink = {
      write: (chunk) => {
        whileOpen();
        const { quotaBytes } = this.options;
        if (quotaBytes !== undefined && this.heldBytes() + chunk.length > quotaBytes) {
          return Promise.reject(new TreeFailure(TreeFailureKind.Quota, 'The store is full.'));
        }
        file.append(chunk);
        return Promise.resolve();
      },
      close: () => {
        whileOpen();
        open = false;
        return Promise.resolve();
      },
      abort: () => {
        whileOpen();
        open = false;
        file.length = offset;
        return Promise.resolve();
      },
    };
    return Promise.resolve(succeed(sink));
  }

  open(ref: PackRef, index: number): Promise<DomainResult<ByteSource | undefined>> {
    const file = this.versions.get(packKey(ref))?.files.get(index);
    if (file === undefined) return Promise.resolve(succeed(undefined));
    const source: ByteSource = {
      size: file.length,
      read: (offset, length) =>
        Promise.resolve(file.bytes.slice(offset, Math.min(offset + length, file.length))),
    };
    return Promise.resolve(succeed(source));
  }

  seal(ref: PackRef): Promise<DomainResult<void>> {
    const version = this.versions.get(packKey(ref));
    if (version === undefined || version.sealed) return Promise.resolve(notStaged(ref));
    version.sealed = true;
    return Promise.resolve(succeed(undefined));
  }

  remove(ref: PackRef): Promise<DomainResult<void>> {
    this.versions.delete(packKey(ref));
    return Promise.resolve(succeed(undefined));
  }

  /** Runs the transfer, since nothing in memory cleans up beside it. */
  async transferring<TValue>(work: () => Promise<TValue>): Promise<TValue> {
    return await work();
  }
}
