/**
 * A project's backup generations, as the page asks the storage worker for them:
 * made as the project's policy says whenever the page's clock ticks, made on
 * demand, listed, protected, removed and restored (REQ-STOR-105, REQ-STOR-106,
 * REQ-STOR-198, ADR-0022).
 *
 * The scheduler that decides when a generation is due lives in the worker, one
 * for each session open there, so the page only asks it to tick. A copy to the
 * backups folder goes through the folder the page lends for the call. A
 * generation restored in place of the project leaves the project open to write
 * under a handle the page names, and is heard as an opening is.
 */

import type { DomainResult, ProjectId } from '@audiogubbins/domain';
import type {
  BackupGeneration,
  BackupTick,
  GenerationListing,
  ProjectHeader,
  WriteOutcome,
} from '@audiogubbins/storage';

import type { Operation } from './operations.js';
import type { PagePort } from './page-operations.js';
import type { HeldOpening, ProjectHandle } from './project-operations.js';

/** A tick of the session open under `handle`, the backups folder lent where the page has one. */
type Tick = Operation<
  { readonly handle: ProjectHandle; readonly folder?: PagePort },
  DomainResult<BackupTick>
>;

/** A generation restored in place of the project, now open to write under the handle named. */
export interface RestoredInPlace extends HeldOpening {
  /** The protected generation that holds the project as it was before. */
  readonly previous: BackupGeneration;

  /** Whether storage holds the restored project yet. */
  readonly saved: WriteOutcome;
}

/** The operations of backup generations. */
export type BackupOperations = {
  /** Makes a generation where the policy says one is due now. */
  'backups.tick': Tick;

  /** Makes a protected generation now, as the person asked. */
  'backups.backUpNow': Tick;
  'backups.list': Operation<ProjectId, DomainResult<GenerationListing>>;
  'backups.protect': Operation<
    { readonly project: ProjectId; readonly generation: number; readonly protect: boolean },
    DomainResult<void>
  >;
  'backups.remove': Operation<
    { readonly project: ProjectId; readonly generations: readonly number[] },
    DomainResult<void>
  >;
  'backups.restoreAsNew': Operation<
    { readonly project: ProjectId; readonly generation: number },
    DomainResult<ProjectHeader>
  >;

  /**
   * Restores a generation in place of the project, which no session may hold
   * here, and holds the session it leaves open under `handle`.
   */
  'backups.restoreInPlace': Operation<
    { readonly handle: ProjectHandle; readonly project: ProjectId; readonly generation: number },
    DomainResult<RestoredInPlace>
  >;
};
