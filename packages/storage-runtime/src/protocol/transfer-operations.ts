/**
 * Taking a project out of the storage worker and bringing one in, as the page
 * asks for it, and making a project whole by copying the files it links to
 * (REQ-STOR-099, REQ-STOR-103, REQ-STOR-166, ADR-0022).
 *
 * Each is the storage's own operation, with its argument and answer, but that
 * where the storage takes a port the page alone can serve, the call names the
 * port the page lent for it, and where it takes the session of a project open
 * to write, the call names the project's handle.
 */

import type { AssetId, DomainResult, ProjectId } from '@audiogubbins/domain';
import type {
  AssetConsolidation,
  CopyOptions,
  DirectoryClaim,
  ExportAttempt,
  ExportedBundle,
  ImportIdentity,
  ProjectHeader,
} from '@audiogubbins/storage';

import type { Operation } from './operations.js';
import type { CrossingBytes, CrossingFolder, PagePort } from './page-operations.js';
import type { ProjectHandle } from './project-operations.js';

/** A bundle export, and the project open to write that it waits for, where it is open here. */
type BundleExport<TArgument> = Operation<
  {
    readonly project: ProjectId;
    readonly sink: PagePort;
    readonly options: CopyOptions;
  } & TArgument,
  DomainResult<ExportAttempt<ExportedBundle>>
>;

/** The operations of taking projects out and bringing them in. */
export type TransferOperations = {
  /** Writes a project as a bundle into the sink lent, waiting for the session `held` names. */
  'transfers.exportBundle': BundleExport<{ readonly held?: ProjectHandle }>;
  'transfers.exportBackup': BundleExport<{ readonly generation: number }>;

  /** Writes a project as an unpacked tree into the folder lent. */
  'transfers.exportUnpacked': Operation<
    {
      readonly project: ProjectId;
      readonly folder: PagePort;
      readonly options: CopyOptions & DirectoryClaim;
      readonly held?: ProjectHandle;
    },
    DomainResult<ExportAttempt<readonly AssetId[]>>
  >;
  'transfers.importBundle': Operation<
    { readonly bundle: CrossingBytes; readonly identity: ImportIdentity },
    DomainResult<ProjectHeader>
  >;
  'transfers.importUnpacked': Operation<
    { readonly folder: CrossingFolder; readonly identity: ImportIdentity },
    DomainResult<ProjectHeader>
  >;

  /**
   * Copies every linked file of the project open under `handle` into it, each
   * found by the search the page lent, which may need the person's leave.
   */
  'transfers.consolidate': Operation<
    { readonly handle: ProjectHandle; readonly locate: PagePort },
    DomainResult<readonly AssetConsolidation[]>
  >;
};
