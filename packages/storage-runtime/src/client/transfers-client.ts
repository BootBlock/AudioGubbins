/**
 * Taking projects out of the storage worker and bringing them in, as the page
 * asks for it, and making a project whole by copying the files it links to
 * (REQ-STOR-099, REQ-STOR-103, REQ-STOR-166).
 *
 * The page lends the worker what it writes to and reads from for the call, and
 * lets it go once the call settles (`page-ports.ts`): the sink the person
 * chose, the folder, the search for linked files. A file the page holds is
 * passed as itself, for the worker to read. An export of the project this page
 * writes names its session, which the export waits for until it has written
 * every change.
 */

import type { AssetId, DomainResult, ProjectId } from '@audiogubbins/domain';
import type { ByteSink } from '@audiogubbins/project-format';
import type {
  AssetConsolidation,
  CopyOptions,
  DirectoryClaim,
  DirectoryWriter,
  ExportAttempt,
  ExportedBundle,
  ImportIdentity,
  ProjectHeader,
} from '@audiogubbins/storage';

import type { LendingCall, PageBytes, PageFolder, PageLocate } from './page-ports.js';
import type { RemoteProjectSession } from './remote-project.js';

/** The session of the project this page writes, which an export of it waits for. */
export interface HeldExport {
  readonly held?: RemoteProjectSession;
}

/** Taking projects out and bringing them in. */
export interface TransfersClient {
  /** Writes a project as a bundle into `sink`, and closes it, as `exportBundle` does. */
  exportBundle(
    project: ProjectId,
    sink: ByteSink,
    options: CopyOptions & HeldExport,
    signal?: AbortSignal,
  ): Promise<DomainResult<ExportAttempt<ExportedBundle>>>;

  /** Writes one of a project's backup generations as a bundle into `sink`. */
  exportBackup(
    project: ProjectId,
    generation: number,
    sink: ByteSink,
    options: CopyOptions,
    signal?: AbortSignal,
  ): Promise<DomainResult<ExportAttempt<ExportedBundle>>>;

  /** Writes a project as an unpacked tree into `folder`, as `exportUnpacked` does. */
  exportUnpacked(
    project: ProjectId,
    folder: DirectoryWriter,
    options: CopyOptions & DirectoryClaim & HeldExport,
    signal?: AbortSignal,
  ): Promise<DomainResult<ExportAttempt<readonly AssetId[]>>>;

  /** Brings in the project a bundle holds, as itself or as a copy. */
  importBundle(
    bundle: PageBytes,
    identity: ImportIdentity,
    signal?: AbortSignal,
  ): Promise<DomainResult<ProjectHeader>>;

  /** Brings in the project a folder's unpacked tree holds, as itself or as a copy. */
  importUnpacked(
    folder: PageFolder,
    identity: ImportIdentity,
    signal?: AbortSignal,
  ): Promise<DomainResult<ProjectHeader>>;

  /**
   * Copies every linked file of the project `session` writes into it, one
   * undoable change each, each file found by `locate`.
   */
  consolidate(
    session: RemoteProjectSession,
    locate: PageLocate,
    signal?: AbortSignal,
  ): Promise<DomainResult<readonly AssetConsolidation[]>>;
}

/** The handle of the session an export waits for, where it names one. */
function heldBy({ held }: HeldExport): { readonly held?: number } {
  return held === undefined ? {} : { held: held.handle };
}

/** What a copy holds, as the worker is told it, without the session beside it. */
function copied({ scope, includeCaches }: CopyOptions): CopyOptions {
  return { scope, includeCaches };
}

/** What an unpacked copy holds and may replace, as the worker is told it. */
function claimed(options: CopyOptions & DirectoryClaim): CopyOptions & DirectoryClaim {
  const { replaceAnother } = options;
  return { ...copied(options), ...(replaceAnother === undefined ? {} : { replaceAnother }) };
}

/** Taking projects out and bringing them in, over calls that lend the page's ports. */
export function transfersClient(call: LendingCall): TransfersClient {
  return {
    exportBundle: (project, sink, options, signal) =>
      call(
        'transfers.exportBundle',
        (lend) => ({
          project,
          sink: lend.sink(sink),
          options: copied(options),
          ...heldBy(options),
        }),
        signal,
      ),
    exportBackup: (project, generation, sink, options, signal) =>
      call(
        'transfers.exportBackup',
        (lend) => ({ project, generation, sink: lend.sink(sink), options: copied(options) }),
        signal,
      ),
    exportUnpacked: (project, folder, options, signal) =>
      call(
        'transfers.exportUnpacked',
        (lend) => ({
          project,
          folder: lend.writer(folder),
          options: claimed(options),
          ...heldBy(options),
        }),
        signal,
      ),
    importBundle: (bundle, identity, signal) =>
      call('transfers.importBundle', (lend) => ({ bundle: lend.bytes(bundle), identity }), signal),
    importUnpacked: (folder, identity, signal) =>
      call(
        'transfers.importUnpacked',
        (lend) => ({ folder: lend.folder(folder), identity }),
        signal,
      ),
    consolidate: (session, locate, signal) =>
      call(
        'transfers.consolidate',
        (lend) => ({ handle: session.handle, locate: lend.locate(locate) }),
        signal,
      ),
  };
}
