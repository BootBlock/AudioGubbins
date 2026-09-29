/**
 * What an open project is made with and what its operations give: the
 * services and cadence a session runs with, and the outcomes of a change, a
 * snapshot request and a comparison (REQ-STOR-021, REQ-STOR-194,
 * REQ-STOR-195).
 */

import type { CommandBus } from '@audiogubbins/commands';
import type { Clock, Logger } from '@audiogubbins/diagnostics';
import type { IdGenerator } from '@audiogubbins/domain';
import type { StateDifference } from '@audiogubbins/history';
import type { ProjectState, SnapshotKind } from '@audiogubbins/project-format';

import type { LeaseRecord } from './lease-records.js';
import type { ProjectFiles } from './project-files.js';
import type { RecoveredProject } from './project-recovery.js';
import type { WritingCadence } from './session-writer.js';
import type { LeaseCoordinator, ProjectWriteLease } from './write-lease.js';
import type { WriteOutcome } from './write-queue.js';

/** What a session works with, each made once by the composition root. */
export interface SessionServices {
  readonly files: ProjectFiles;
  readonly bus: CommandBus<ProjectState>;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly logger: Logger;
  readonly coordinator: LeaseCoordinator;
}

/** How often a session checkpoints and keeps a state whole along the way. */
export interface SessionCadence extends WritingCadence {
  /**
   * A state is kept whole once this many changes have been made since the
   * nearest state kept above it, so no move replays more than this many.
   */
  readonly keepStateEvery: number;
}

/** The cadence an application session runs at. */
export const DEFAULT_CADENCE: SessionCadence = { checkpointAfter: 256, keepStateEvery: 64 };

/** What a session opens with. */
export interface SessionStart {
  readonly recovered: RecoveredProject;
  readonly lease: ProjectWriteLease;

  /** The lease record the opening wrote, whose epoch the session writes under. */
  readonly leaseRecord: LeaseRecord;
  readonly headerName: string | undefined;
  readonly cadence: SessionCadence;
}

/** What running a command came to. */
export type ChangeOutcome =
  | { readonly kind: 'applied'; readonly saved: WriteOutcome }
  | { readonly kind: 'unchanged'; readonly code: string; readonly reason: string };

/** A snapshot to make of the current state. */
export interface SnapshotRequest {
  readonly name: string;
  readonly notes?: string;
  readonly author?: string;

  /** `named` unless the application makes it before something irreversible. */
  readonly kind?: SnapshotKind;
}

/** A comparison opened, and what differs between its sides. */
export interface ComparisonOutcome {
  readonly difference: StateDifference;
  readonly saved: WriteOutcome;
}
