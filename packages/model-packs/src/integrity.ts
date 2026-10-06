/**
 * The integrity check: a pack's file is the file its manifest names, by its
 * length and its SHA-256, or it is not used (ADR-0062, REQ-AUDIO-139).
 *
 * The digest is injected, because it belongs to the platform. It is taken over
 * bytes handed in order, a mebibyte at a time, so a file of hundreds of
 * megabytes is checked without being held whole; Web Crypto's digest takes its
 * input whole and so cannot be the port. A file read for use is held whole
 * anyway, since the runtime loads a model from one buffer, and is checked as it
 * is read, so no byte reaches the runtime before the whole file matched.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainFailureResult,
  type DomainResult,
} from '@audiogubbins/domain';
import { hexOf, type ByteSource } from '@audiogubbins/project-format';

import { refOf, type ModelPackManifest, type PackFile, type PackRef } from './manifest.js';
import type { PackStore } from './pack-store.js';

/** A SHA-256 being taken over bytes handed to it in order. */
export interface Sha256Run {
  update(bytes: Uint8Array<ArrayBuffer>): Promise<void>;
  /** The 32 bytes of the digest of everything handed over; the run ends. */
  digest(): Promise<Uint8Array>;
}

/** Starts a SHA-256: the platform's, injected. */
export type Sha256 = () => Sha256Run;

/** The bytes read and hashed at a time. */
const CHUNK_BYTES = 1_048_576;

/** A file kept whose bytes are not those its manifest names. */
function mismatch(
  file: PackFile,
  code: string,
  summary: string,
  found?: number,
): DomainFailureResult {
  return fail(
    failure(code, FailureKind.IntegrityViolation, summary, {
      details: {
        file: file.path,
        expectedBytes: file.bytes,
        ...(found === undefined ? {} : { foundBytes: found }),
      },
    }),
  );
}

function sizeMismatch(file: PackFile, found: number): DomainFailureResult {
  return mismatch(
    file,
    'model-pack.file-size-mismatch',
    `The file ${file.path} is not the length its manifest states.`,
    found,
  );
}

/**
 * Hashes `source` a chunk at a time, copying each chunk into `into` where it is
 * given, and answers whether it is `file`. Rejects with the signal's reason
 * when `signal` aborts.
 */
async function checked(
  source: ByteSource,
  file: PackFile,
  sha256: Sha256,
  into: Uint8Array<ArrayBuffer> | undefined,
  signal: AbortSignal | undefined,
): Promise<DomainResult<void>> {
  if (source.size !== file.bytes) return sizeMismatch(file, source.size);
  const run = sha256();
  for (let offset = 0; offset < file.bytes; offset += CHUNK_BYTES) {
    signal?.throwIfAborted();
    const length = Math.min(CHUNK_BYTES, file.bytes - offset);
    const bytes = await source.read(offset, length, signal);
    if (bytes.length !== length) {
      return mismatch(
        file,
        'model-pack.file-short-read',
        `The file ${file.path} changed while it was read.`,
        offset + bytes.length,
      );
    }
    into?.set(bytes, offset);
    await run.update(bytes);
  }
  signal?.throwIfAborted();
  return hexOf(await run.digest()) === file.sha256
    ? succeed(undefined)
    : mismatch(
        file,
        'model-pack.file-hash-mismatch',
        `The file ${file.path} is not the file its manifest names: its SHA-256 differs.`,
      );
}

/** Whether `source` is `file`: its length, and the SHA-256 of its bytes. */
async function verifyFile(
  source: ByteSource,
  file: PackFile,
  sha256: Sha256,
  signal?: AbortSignal,
): Promise<DomainResult<void>> {
  return await checked(source, file, sha256, undefined, signal);
}

/**
 * The whole of `source`, where it is `file`; checked as it is read, so the
 * bytes are handed over only once every one has matched.
 */
async function readVerified(
  source: ByteSource,
  file: PackFile,
  sha256: Sha256,
  signal?: AbortSignal,
): Promise<DomainResult<Uint8Array<ArrayBuffer>>> {
  if (source.size !== file.bytes) return sizeMismatch(file, source.size);
  // Sized by the manifest, which the reader bounds, so a source cannot make
  // this allocate more than the pack said it holds.
  const whole = new Uint8Array(file.bytes);
  const result = await checked(source, file, sha256, whole, signal);
  return result.ok ? succeed(whole) : result;
}

/** A file the manifest names that the store does not keep. */
function fileMissing(file: PackFile): DomainFailureResult {
  return fail(
    failure(
      'model-pack.file-missing',
      FailureKind.IntegrityViolation,
      `The file ${file.path} is not kept.`,
      { details: { file: file.path } },
    ),
  );
}

/** Whether the store keeps every file of `manifest`, each its length and SHA-256. */
export async function verifyKept(
  store: PackStore,
  manifest: ModelPackManifest,
  sha256: Sha256,
): Promise<DomainResult<void>> {
  const ref = refOf(manifest);
  for (const [index, file] of manifest.files.entries()) {
    const opened = await store.open(ref, index);
    if (!opened.ok) return opened;
    const checked =
      opened.value === undefined ? fileMissing(file) : await verifyFile(opened.value, file, sha256);
    if (!checked.ok) return checked;
  }
  return succeed(undefined);
}

/** The whole of the file at `index` of a kept version, where it is `file`, checked as it is read. */
export async function readKept(
  store: PackStore,
  ref: PackRef,
  index: number,
  file: PackFile,
  sha256: Sha256,
  signal?: AbortSignal,
): Promise<DomainResult<Uint8Array<ArrayBuffer>>> {
  const opened = await store.open(ref, index);
  if (!opened.ok) return opened;
  return opened.value === undefined
    ? fileMissing(file)
    : await readVerified(opened.value, file, sha256, signal);
}
