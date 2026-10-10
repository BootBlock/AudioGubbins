/**
 * The export staging area (ADR-0092, REQ-STOR-106): an export's encoded file
 * written as the codec worker encodes it, kept until it is delivered, and
 * given up after.
 *
 * The body is written as it arrives, through one sink, and the head and tail
 * once the encoder finishes, since a container may complete its head only
 * when the stream ends; the three files lie in the storage's staging
 * (`staging-paths.ts`). The whole file's SHA-256 is taken once it is staged,
 * reading the body back once, which a trusted folder's later exports are
 * checked against and the export's record names. A delivery refused keeps the
 * file staged, so the person can retry or choose another destination without
 * a new render; a delivered one is removed.
 *
 * Staging is a cache, never a root: storage pressure may give it up, and a
 * delivery then finds it gone and says so. While anything is staged or being
 * staged, the area shares the storage-wide lock, so no window starting clears
 * the staging under it; with nothing staged, it shares nothing. A stream that
 * fails, breaks its order, whose write the storage refuses, or that is
 * cancelled keeps nothing, and the codec worker is told.
 */

import type { MetadataPart } from '@audiogubbins/codecs';
import {
  fail,
  succeed,
  type DomainFailure,
  type DomainResult,
  type ProjectId,
} from '@audiogubbins/domain';
import type { ExportSettings } from '@audiogubbins/import-export';
import type { MediaSharing } from '@audiogubbins/media-store';
import type { Sha256 } from '@audiogubbins/model-packs';
import {
  CONTENT_CHUNK_BYTES,
  TreeFailure,
  TreeFailureKind,
  hexOf,
  type ByteSink,
  type ByteSource,
  type ExportCodec,
  type StateFingerprint,
  type StorageTree,
} from '@audiogubbins/project-format';

import type { EncodedStream } from './encoded-stream.js';
import { encodedOutOfOrder, exportCancelled } from './export-failures.js';
import { stagedExportPaths, type StagedExportPaths } from './staging-paths.js';
import { storageRefused } from './storage-failures.js';

/** What an export was made from and with, which its record names once it is delivered. */
export interface ExportOrigin {
  readonly settings: ExportSettings;
  readonly codec: ExportCodec;

  /** Whether the codec gives the same bytes on every machine. */
  readonly reproducible: boolean;

  /** The state rendered, and the history node it was at, where it was at one. */
  readonly stateFingerprint: StateFingerprint;
  readonly historyNodeId?: string;

  /** The version of each engine and processor that rendered, by name. */
  readonly engineVersions: ReadonlyMap<string, string>;
}

/** An export staged, ready to be delivered. */
export interface StagedExport {
  /** The name it is staged under, which the page delivers it by. */
  readonly token: string;
  readonly project: ProjectId;
  readonly paths: StagedExportPaths;

  /** The whole file's length and SHA-256, in lower-case hexadecimal. */
  readonly bytes: number;
  readonly sha256: string;

  /** The parts of the metadata the format could not hold, so none is dropped unsaid. */
  readonly dropped: readonly MetadataPart[];
  readonly origin: ExportOrigin;
}

/** What staging works with, each made once by the composition root. */
export interface StagingServices {
  readonly tree: StorageTree;
  readonly sha256: Sha256;

  /** Tokens no other window draws, which name a staged export. */
  readonly nextToken: () => string;

  /** The storage-wide lock, shared while anything is staged. */
  readonly sharing: MediaSharing;
}

/** The exports staged by this window (see the module comment). */
export class ExportStaging {
  readonly #services: StagingServices;
  readonly #staged = new Map<string, StagedExport>();
  #holding = 0;
  #release: (() => void) | undefined;

  constructor(services: StagingServices) {
    this.#services = services;
  }

  /**
   * Stages the export of `project` the codec worker encodes to `stream`,
   * telling `progress` the body's bytes as they are written (see the module
   * comment). Rejects with the signal's reason, having kept nothing, where the
   * export is cancelled.
   */
  async stage(
    project: ProjectId,
    origin: ExportOrigin,
    stream: EncodedStream,
    progress: (bytesStaged: number) => void,
    signal?: AbortSignal,
  ): Promise<DomainResult<StagedExport>> {
    await this.#hold(signal);
    const token = this.#services.nextToken();
    const paths = stagedExportPaths(project, token);
    let staged: StagedExport | undefined;
    try {
      const written = await this.#written(paths, stream, progress, signal);
      if (!written.ok) return written;
      const { head, tail, dropped } = written.value;
      const body = await this.#services.tree.openFile(paths.body);
      if (body === undefined)
        throw new TreeFailure(TreeFailureKind.Io, 'The staged export vanished.');
      staged = {
        token,
        project,
        paths,
        bytes: head.length + body.size + tail.length,
        sha256: await this.#sha256(head, body, tail, signal),
        dropped,
        origin,
      };
      this.#staged.set(token, staged);
      return succeed(staged);
    } finally {
      if (staged === undefined) await this.#removeFiles(paths);
      else this.#holding += 1;
      this.#let();
    }
  }

  /** The export staged under `token`, where it still is. */
  staged(token: string): StagedExport | undefined {
    return this.#staged.get(token);
  }

  /**
   * The staged file's parts, in order: its head, its body and its tail, where
   * they are all still there, which storage pressure may have given up.
   */
  async parts(staged: StagedExport): Promise<readonly ByteSource[] | undefined> {
    const parts: ByteSource[] = [];
    for (const path of [staged.paths.head, staged.paths.body, staged.paths.tail]) {
      const part = await this.#services.tree.openFile(path);
      if (part === undefined) return undefined;
      parts.push(part);
    }
    return parts;
  }

  /** Gives up the export staged under `token`, delivered or no longer wanted. */
  async discard(token: string): Promise<void> {
    const staged = this.#staged.get(token);
    if (staged === undefined) return;
    this.#staged.delete(token);
    try {
      await this.#removeFiles(staged.paths);
    } finally {
      this.#let();
    }
  }

  /** Writes the stream's body, then its head and tail, or says why it ended. */
  async #written(
    paths: StagedExportPaths,
    stream: EncodedStream,
    progress: (bytesStaged: number) => void,
    signal?: AbortSignal,
  ): Promise<
    DomainResult<{
      readonly head: Uint8Array;
      readonly tail: Uint8Array;
      readonly dropped: readonly MetadataPart[];
    }>
  > {
    const { tree } = this.#services;
    let sink: ByteSink | undefined;
    let closed = false;
    try {
      sink = await tree.createFile(paths.body);
      let bytes = 0;
      for (;;) {
        signal?.throwIfAborted();
        const message = await stream.next();
        signal?.throwIfAborted();
        switch (message?.kind) {
          case 'body':
            await sink.write(message.bytes);
            bytes += message.bytes.length;
            progress(bytes);
            continue;
          case 'finished': {
            const { head, tail, dropped } = message.file;
            await sink.close();
            closed = true;
            await tree.writeFile(paths.head, head);
            await tree.writeFile(paths.tail, tail);
            stream.close();
            return succeed({ head, tail, dropped });
          }
          case 'failed':
            stream.refuse(message.failure);
            return fail(message.failure);
          case undefined:
            return refused(stream, encodedOutOfOrder('the stream stopped before it finished'));
        }
      }
    } catch (error) {
      if (signal?.aborted === true) {
        stream.refuse(exportCancelled());
        throw error;
      }
      if (!(error instanceof TreeFailure)) {
        stream.refuse(encodedOutOfOrder('the storage failed to write it'));
        throw error;
      }
      return refused(stream, storageRefused(error));
    } finally {
      if (!closed) await sink?.abort();
    }
  }

  /** The SHA-256 of the head, the body read back in chunks, and the tail. */
  async #sha256(
    head: Uint8Array,
    body: ByteSource,
    tail: Uint8Array,
    signal?: AbortSignal,
  ): Promise<string> {
    const run = this.#services.sha256();
    await run.update(Uint8Array.from(head));
    for (let offset = 0; offset < body.size; offset += CONTENT_CHUNK_BYTES) {
      signal?.throwIfAborted();
      const length = Math.min(CONTENT_CHUNK_BYTES, body.size - offset);
      const chunk = await body.read(offset, length, signal);
      if (chunk.length !== length) {
        throw new TreeFailure(TreeFailureKind.Io, 'The staged export changed as it was read.');
      }
      await run.update(chunk);
    }
    await run.update(Uint8Array.from(tail));
    return hexOf(await run.digest());
  }

  async #removeFiles(paths: StagedExportPaths): Promise<void> {
    const { tree } = this.#services;
    for (const path of [paths.head, paths.body, paths.tail]) await tree.remove(path);
  }

  /** Shares the storage-wide lock for one more thing staged or being staged. */
  async #hold(signal?: AbortSignal): Promise<void> {
    if (this.#holding === 0 && this.#release === undefined) {
      this.#release = await this.#services.sharing.share(signal);
    }
    this.#holding += 1;
  }

  /** Lets go of one, and of the lock where nothing is staged or being staged. */
  #let(): void {
    this.#holding -= 1;
    if (this.#holding > 0) return;
    this.#release?.();
    this.#release = undefined;
  }
}

/** Refuses the stream for `failure`, which staging fails with. */
function refused(stream: EncodedStream, failure: DomainFailure): DomainResult<never> {
  stream.refuse(failure);
  return fail(failure);
}
