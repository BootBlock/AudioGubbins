import { describe, expect, it } from 'vitest';

import type { DomainResult } from '@audiogubbins/domain';
import type { ByteSource } from '@audiogubbins/project-format';

import { readKept, verifyKept, type Sha256 } from './integrity.js';
import { refOf, type PackFile } from './manifest.js';
import type { PackStore } from './pack-store.js';
import { nodeSha256, patterned, sha256Hex } from './testing/node-sha256.js';
import { sampleManifest } from './testing/sample-packs.js';

function sourceOf(bytes: Uint8Array<ArrayBuffer>, reads?: number[]): ByteSource {
  return {
    size: bytes.length,
    read: (offset, length) => {
      reads?.push(length);
      return Promise.resolve(bytes.slice(offset, offset + length));
    },
  };
}

/** A store that keeps `sources` as a version's files, by place, and is asked nothing else. */
function keeping(...sources: readonly (ByteSource | undefined)[]): PackStore {
  const unused = (): never => {
    throw new Error('The integrity check only opens files.');
  };
  return {
    kept: unused,
    stage: unused,
    stagedBytes: unused,
    append: unused,
    seal: unused,
    remove: unused,
    open: (_ref, index) => Promise.resolve({ ok: true, value: sources[index] }),
  };
}

/** Checks one kept file, as the installer checks each before it seals a version. */
async function verifyFile(source: ByteSource, file: PackFile, sha256: Sha256) {
  return await verifyKept(keeping(source), sampleManifest({ files: [file] }), sha256);
}

/** Reads one kept file for use. */
async function readVerified(
  source: ByteSource,
  file: PackFile,
  sha256: Sha256,
  signal?: AbortSignal,
) {
  const manifest = sampleManifest({ files: [file] });
  return await readKept(keeping(source), refOf(manifest), 0, file, sha256, signal);
}

function fileOf(bytes: Uint8Array, path = 'model.onnx'): PackFile {
  return { path, bytes: bytes.length, sha256: sha256Hex(bytes) };
}

function codes<TValue>(result: DomainResult<TValue>): readonly string[] {
  return result.ok ? [] : result.failures.map((failure) => failure.code);
}

/**
 * A digest that is not SHA-256: the sum of every byte handed to it, in the last
 * of 32 bytes. Enough to show the check compares what the port gives with what
 * the manifest states, and hands it every byte in order.
 */
function summingDigest(handed: number[]): Sha256 {
  return () => {
    let sum = 0;
    return {
      update: (bytes) => {
        handed.push(bytes.length);
        for (const byte of bytes) sum = (sum + byte) % 256;
        return Promise.resolve();
      },
      digest: () => {
        const digest = new Uint8Array(32);
        digest[31] = sum;
        return Promise.resolve(digest);
      },
    };
  };
}

describe('the integrity check', () => {
  it('accepts a file whose length and SHA-256 are its manifest’s', async () => {
    const bytes = patterned(3_000_000, 4);
    expect(await verifyFile(sourceOf(bytes), fileOf(bytes), nodeSha256)).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it('compares what the injected digest gives with the hash the manifest states', async () => {
    const bytes = new Uint8Array([1, 2, 3, 250]);
    const handed: number[] = [];
    const matching: PackFile = { path: 'm.onnx', bytes: 4, sha256: `${'0'.repeat(62)}00` };
    expect((await verifyFile(sourceOf(bytes), matching, summingDigest(handed))).ok).toBe(true);
    expect(handed).toEqual([4]);

    const differing: PackFile = { ...matching, sha256: `${'0'.repeat(62)}01` };
    expect(codes(await verifyFile(sourceOf(bytes), differing, summingDigest([])))).toEqual([
      'model-pack.file-hash-mismatch',
    ]);
  });

  it('refuses a file one byte of which is corrupted, naming the file', async () => {
    const bytes = patterned(2_500_000, 5);
    const file = fileOf(bytes, 'models/decoder.onnx');
    const corrupted = bytes.slice();
    corrupted[2_000_000] = (corrupted[2_000_000] ?? 0) ^ 1;

    const result = await verifyFile(sourceOf(corrupted), file, nodeSha256);
    expect(codes(result)).toEqual(['model-pack.file-hash-mismatch']);
    expect(result.ok ? undefined : result.failures[0].details?.['file']).toBe(
      'models/decoder.onnx',
    );
  });

  it('refuses a file of another length without reading it', async () => {
    const bytes = patterned(10, 6);
    const reads: number[] = [];
    const result = await verifyFile(sourceOf(bytes.slice(0, 9), reads), fileOf(bytes), nodeSha256);
    expect(codes(result)).toEqual(['model-pack.file-size-mismatch']);
    expect(reads).toEqual([]);
  });

  it('reads a large file a mebibyte at a time, never whole', async () => {
    const bytes = patterned(2_500_000, 7);
    const reads: number[] = [];
    await verifyFile(sourceOf(bytes, reads), fileOf(bytes), nodeSha256);
    expect(reads).toEqual([1_048_576, 1_048_576, 402_848]);
  });

  it('refuses a source that returns other than the bytes asked for', async () => {
    const bytes = patterned(10, 8);
    const shrinking: ByteSource = {
      size: 10,
      read: (offset, length) => Promise.resolve(bytes.slice(offset, offset + length - 1)),
    };
    expect(codes(await verifyFile(shrinking, fileOf(bytes), nodeSha256))).toEqual([
      'model-pack.file-short-read',
    ]);
  });

  it('hands over the bytes read for use only once every one matched', async () => {
    const bytes = patterned(1_500_000, 9);
    const read = await readVerified(sourceOf(bytes), fileOf(bytes), nodeSha256);
    expect(read.ok && read.value).toEqual(bytes);

    const corrupted = bytes.slice();
    corrupted[1_400_000] = (corrupted[1_400_000] ?? 0) ^ 0x80;
    const refused = await readVerified(sourceOf(corrupted), fileOf(bytes), nodeSha256);
    expect(codes(refused)).toEqual(['model-pack.file-hash-mismatch']);
  });

  it('rejects with the signal’s reason when it aborts', async () => {
    const bytes = patterned(10, 10);
    const controller = new AbortController();
    controller.abort(new Error('stopped'));
    await expect(
      readVerified(sourceOf(bytes), fileOf(bytes), nodeSha256, controller.signal),
    ).rejects.toThrow('stopped');
  });

  it('checks every file of a version, and refuses one the store does not keep', async () => {
    const first = patterned(10, 11);
    const second = patterned(7, 12);
    const manifest = sampleManifest({
      files: [fileOf(first, 'encoder.onnx'), fileOf(second, 'decoder.onnx')],
    });
    expect(
      (await verifyKept(keeping(sourceOf(first), sourceOf(second)), manifest, nodeSha256)).ok,
    ).toBe(true);

    const rotten = second.slice();
    rotten[6] = (rotten[6] ?? 0) ^ 4;
    const refused = await verifyKept(
      keeping(sourceOf(first), sourceOf(rotten)),
      manifest,
      nodeSha256,
    );
    expect(refused.ok ? undefined : refused.failures[0].details?.['file']).toBe('decoder.onnx');

    expect(codes(await verifyKept(keeping(sourceOf(first)), manifest, nodeSha256))).toEqual([
      'model-pack.file-missing',
    ]);
  });
});
