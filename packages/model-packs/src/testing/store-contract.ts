/**
 * The pack store's contract, as tests every implementation is held to: the
 * storage's over the storage tree and the installer's in memory, so the
 * installer's tests prove what they prove of the store it really runs on.
 */

import { describe, expect, it } from 'vitest';

import type { DomainResult } from '@audiogubbins/domain';
import type { ByteSource } from '@audiogubbins/project-format';

import { refOf } from '../manifest.js';
import type { PackStore } from '../pack-store.js';
import { sampleManifest } from './sample-packs.js';

/** The value of a result that must have succeeded. */
function valueOf<TValue>(result: DomainResult<TValue>): TValue {
  if (!result.ok) throw new Error(result.failures.map((one) => one.summary).join(' '));
  return result.value;
}

async function bytesOf(source: ByteSource | undefined): Promise<readonly number[] | undefined> {
  return source === undefined ? undefined : [...(await source.read(0, source.size))];
}

/** Appends `bytes` to a file and closes the run. */
async function appended(store: PackStore, index: number, bytes: readonly number[]): Promise<void> {
  const sink = valueOf(await store.append(refOf(sampleManifest()), index));
  await sink.write(new Uint8Array(bytes));
  await sink.close();
}

/** Holds the store `make` gives to the pack store's contract. */
export function describePackStoreContract(name: string, make: () => PackStore): void {
  const manifest = sampleManifest();
  const ref = refOf(manifest);

  describe(`the pack store contract: ${name}`, () => {
    it('keeps nothing at first, and opens nothing it does not keep', async () => {
      const store = make();
      expect(valueOf(await store.kept())).toEqual([]);
      expect(valueOf(await store.open(ref, 0))).toBeUndefined();
    });

    it('keeps a staged version with no bytes, then each run appended, in order', async () => {
      const store = make();
      valueOf(await store.stage(manifest));
      expect(valueOf(await store.kept())).toEqual([{ kind: 'staged', manifest, received: 0 }]);

      await appended(store, 0, [1, 2]);
      await appended(store, 0, [3, 4]);
      await appended(store, 1, [9]);

      expect(valueOf(await store.stagedBytes(ref, 0))).toBe(4);
      expect(valueOf(await store.stagedBytes(ref, 1))).toBe(1);
      expect(await bytesOf(valueOf(await store.open(ref, 0)))).toEqual([1, 2, 3, 4]);
      expect(valueOf(await store.kept())).toEqual([{ kind: 'staged', manifest, received: 5 }]);
    });

    it('keeps nothing of an aborted run, and all of the runs before it', async () => {
      const store = make();
      valueOf(await store.stage(manifest));
      await appended(store, 0, [1, 2]);
      const sink = valueOf(await store.append(ref, 0));
      await sink.write(new Uint8Array([3, 4]));
      await sink.abort();

      expect(valueOf(await store.stagedBytes(ref, 0))).toBe(2);
      expect(await bytesOf(valueOf(await store.open(ref, 0)))).toEqual([1, 2]);
    });

    it('carries on with what is staged under the same manifest, and drops it under another', async () => {
      const store = make();
      valueOf(await store.stage(manifest));
      await appended(store, 0, [1, 2]);

      valueOf(await store.stage(sampleManifest()));
      expect(valueOf(await store.stagedBytes(ref, 0))).toBe(2);

      const changed = sampleManifest({
        files: [{ path: 'encoder.onnx', bytes: 5, sha256: 'f'.repeat(64) }],
      });
      valueOf(await store.stage(changed));
      expect(valueOf(await store.stagedBytes(ref, 0))).toBe(0);
      expect(valueOf(await store.kept())).toEqual([
        { kind: 'staged', manifest: changed, received: 0 },
      ]);
    });

    it('keeps a sealed version sealed, with its files, and refuses to stage it again', async () => {
      const store = make();
      valueOf(await store.stage(manifest));
      await appended(store, 0, [1, 2, 3, 4, 5]);
      await appended(store, 1, [6, 7, 8]);
      valueOf(await store.seal(ref));

      expect(valueOf(await store.kept())).toEqual([{ kind: 'sealed', manifest }]);
      expect(await bytesOf(valueOf(await store.open(ref, 1)))).toEqual([6, 7, 8]);
      expect((await store.stage(manifest)).ok).toBe(false);
      expect((await store.append(ref, 0)).ok).toBe(false);
    });

    it('removes everything of a version and nothing of another', async () => {
      const store = make();
      const other = sampleManifest({ version: '1.1.0' });
      valueOf(await store.stage(manifest));
      valueOf(await store.stage(other));
      await appended(store, 0, [1]);
      valueOf(await store.seal(ref));

      valueOf(await store.remove(ref));
      valueOf(await store.remove(ref));

      expect(valueOf(await store.kept())).toEqual([
        { kind: 'staged', manifest: other, received: 0 },
      ]);
      expect(valueOf(await store.open(ref, 0))).toBeUndefined();
    });

    it('lists versions by id and then version', async () => {
      const store = make();
      const later = sampleManifest({ id: 'sample-pack', version: '1.1.0' });
      const another = sampleManifest({ id: 'another-pack' });
      valueOf(await store.stage(later));
      valueOf(await store.stage(manifest));
      valueOf(await store.stage(another));

      expect(
        valueOf(await store.kept()).map((pack) =>
          pack.kind === 'damaged' ? pack.ref : refOf(pack.manifest),
        ),
      ).toEqual([refOf(another), ref, refOf(later)]);
    });
  });
}
