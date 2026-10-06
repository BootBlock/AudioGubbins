/**
 * A pack a person already has, as a `PackSource`: its manifest and its files,
 * by their paths in the manifest (ADR-0062).
 *
 * The application reads the manifest the person chose with the manifest reader
 * and gives the files beside it as byte sources, which it opens without
 * reading; this source serves them to the installer exactly as the download
 * serves a catalogue's, so an import is kept, checked against every hash and
 * refused on a mismatch by the same path.
 */

import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';
import type { ByteSource } from '@audiogubbins/project-format';

import { refOf, sameRef, type ModelPackManifest } from './manifest.js';
import {
  sourceOverran,
  transferStopped,
  type FileRange,
  type PackSource,
  type ReceiveChunk,
} from './pack-source.js';

/** The bytes handed on at a time. */
const CHUNK_BYTES = 1_048_576;

/** The files of one pack a person has (see the module comment). */
export class ImportedPackSource implements PackSource {
  private readonly manifest: ModelPackManifest;
  private readonly files: ReadonlyMap<string, ByteSource>;

  /** `files` holds each file of `manifest` by its path. */
  constructor(manifest: ModelPackManifest, files: ReadonlyMap<string, ByteSource>) {
    this.manifest = manifest;
    this.files = files;
  }

  catalogue(): Promise<DomainResult<readonly ModelPackManifest[]>> {
    return Promise.resolve(succeed([this.manifest]));
  }

  async read(
    range: FileRange,
    receive: ReceiveChunk,
    signal?: AbortSignal,
  ): Promise<DomainResult<void>> {
    const source = this.files.get(range.file.path);
    if (!sameRef(refOf(range.pack), refOf(this.manifest)) || source === undefined) {
      return fail(
        failure(
          'model-pack.import-file-missing',
          FailureKind.Rejected,
          `The files chosen do not include ${range.file.path}.`,
          { details: { file: range.file.path } },
        ),
      );
    }
    if (source.size > range.file.bytes) return sourceOverran(range);
    if (source.size < range.file.bytes) {
      return integrity(
        range,
        `The file chosen for ${range.file.path} is shorter than its manifest states.`,
      );
    }
    for (let offset = range.offset; offset < source.size; offset += CHUNK_BYTES) {
      // Checked between chunks rather than handed to the read, whose abort
      // would reject where this port answers.
      if (signal?.aborted === true) return transferStopped();
      const length = Math.min(CHUNK_BYTES, source.size - offset);
      const chunk = await source.read(offset, length);
      if (chunk.length !== length) {
        return integrity(
          range,
          `The file chosen for ${range.file.path} changed while it was read.`,
        );
      }
      const taken = await receive(chunk);
      if (!taken.ok) return taken;
    }
    return succeed(undefined);
  }
}

/** A chosen file that is not the one its manifest names. */
function integrity(range: FileRange, summary: string): DomainResult<never> {
  return fail(
    failure('model-pack.import-file-differs', FailureKind.IntegrityViolation, summary, {
      details: { file: range.file.path, expectedBytes: range.file.bytes },
    }),
  );
}
