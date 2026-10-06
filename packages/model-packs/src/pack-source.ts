/**
 * Where packs come from: the port a catalogue is listed and a pack's files are
 * read through (ADR-0062).
 *
 * A file is read from a byte offset to its end, streamed to the caller a chunk
 * at a time, so a download that stopped resumes from the bytes already kept
 * rather than from the start, and the chunks it receives are its progress. Two
 * sources implement it: the download from the catalogue the build configures
 * (`adapter/http-pack-source.ts`, the one module in the repository that reaches
 * the network) and the files a person already has (`imported-pack-source.ts`);
 * both are installed by the same path and checked by the same hashes. A source
 * answers every failure as a result, an abort included, and never delivers a
 * byte past the end of the file it was asked for.
 */

import {
  FailureKind,
  fail,
  failure,
  type DomainFailureResult,
  type DomainResult,
} from '@audiogubbins/domain';

import type { ModelPackManifest, PackFile } from './manifest.js';

/** The bytes of one file of a pack, from `offset` to its end. */
export interface FileRange {
  readonly pack: ModelPackManifest;
  readonly file: PackFile;
  readonly offset: number;
}

/**
 * Takes the next chunk of a file. A failure stops the read, which answers it;
 * the chunk's buffer is the receiver's from the call.
 */
export type ReceiveChunk = (chunk: Uint8Array<ArrayBuffer>) => Promise<DomainResult<void>>;

/** Lists packs, and reads their files (see the module comment). */
export interface PackSource {
  /** The packs the source offers. */
  catalogue(signal?: AbortSignal): Promise<DomainResult<readonly ModelPackManifest[]>>;

  /**
   * Hands every byte of `range` to `receive`, in order, and succeeds once the
   * last has been taken. Fails as `model-pack.transfer-stopped` when `signal`
   * aborts. A failure whose kind is an integrity violation means the source's
   * file is not the one the manifest names, so nothing received of it may be
   * continued from; any other may be resumed from the bytes taken.
   */
  read(range: FileRange, receive: ReceiveChunk, signal?: AbortSignal): Promise<DomainResult<void>>;
}

/** The answer to a read whose signal aborted. */
export function transferStopped(): DomainFailureResult {
  return fail(
    failure('model-pack.transfer-stopped', FailureKind.Rejected, 'The transfer was stopped.'),
  );
}

/** The answer to a source that would deliver more than the file holds. */
export function sourceOverran(range: FileRange): DomainFailureResult {
  return fail(
    failure(
      'model-pack.source-overran',
      FailureKind.IntegrityViolation,
      `The source holds more of ${range.file.path} than its manifest states, so it is another file.`,
      { details: { file: range.file.path, expectedBytes: range.file.bytes } },
    ),
  );
}
