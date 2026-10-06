/**
 * What this package's own tests hash with: SHA-256 through Node's streaming
 * hash, as the platform's would be injected, and manifests whose hashes are
 * those of the bytes a test gives.
 *
 * Kept apart from the test support other packages take, which never reaches a
 * Node module, so that support compiles wherever the package's entry points do.
 */

import { createHash } from 'node:crypto';

import type { Sha256 } from '../integrity.js';
import type { ModelPackManifest, PackFile } from '../manifest.js';
import { sampleManifest, type SampleOptions } from './sample-packs.js';

/** SHA-256 through `node:crypto`. */
export const nodeSha256: Sha256 = () => {
  const hash = createHash('sha256');
  return {
    update: (bytes) => {
      hash.update(bytes);
      return Promise.resolve();
    },
    digest: () => Promise.resolve(new Uint8Array(hash.digest())),
  };
};

/** The SHA-256 of `bytes`, in lower-case hexadecimal. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** A pack's manifest and its files' bytes, by path. */
export interface TestPack {
  readonly manifest: ModelPackManifest;
  readonly files: ReadonlyMap<string, Uint8Array<ArrayBuffer>>;
}

/** Bytes that differ from place to place, so a misplaced run shows. */
export function patterned(length: number, seed: number): Uint8Array<ArrayBuffer> {
  return Uint8Array.from({ length }, (_, index) => (index * 31 + seed * 17) % 251);
}

/**
 * A pack of `files`, by path, whose manifest states their real lengths and
 * hashes: by default an encoder of 10 bytes and a decoder of 7.
 */
export function testPack(
  options: Omit<SampleOptions, 'files'> & {
    readonly files?: Readonly<Record<string, Uint8Array<ArrayBuffer>>>;
  } = {},
): TestPack {
  const bytes = options.files ?? {
    'encoder.onnx': patterned(10, 1),
    'models/decoder.onnx': patterned(7, 2),
  };
  const files: PackFile[] = Object.entries(bytes).map(([path, content]) => ({
    path,
    bytes: content.length,
    sha256: sha256Hex(content),
  }));
  return {
    manifest: sampleManifest({ ...options, files }),
    files: new Map(Object.entries(bytes)),
  };
}
