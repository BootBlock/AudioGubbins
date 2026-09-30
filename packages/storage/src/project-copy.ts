/**
 * A project read to be copied out: into a bundle, an unpacked tree, a backup
 * generation or a fork (REQ-STOR-099, REQ-STOR-103, REQ-STOR-105,
 * REQ-STOR-199).
 *
 * A live project is read as a read-only window reads it: rebuilt from its head,
 * its checkpoint and every journal record after it, so the copy holds every
 * change written, and nothing in storage is changed by reading it. The states
 * the copy offers are those its history keeps that storage holds whole or that
 * replay rebuilt, each checked when it is read.
 *
 * A copy never leaves out a change storage holds without saying so. Where the
 * read finds records it cannot include, a break in the journal or a fenced
 * writer's records, and the project's head moved meanwhile, a live writer's
 * checkpoint pruned records the read had yet to reach, so it reads again from
 * the newer head. Where the head stayed, the records are damaged, and the copy
 * is refused until the project is opened, which shows what recovery found and
 * sets them aside for good, rather than made silently older than the project.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainFailure,
  type DomainResult,
  type ProjectId,
} from '@audiogubbins/domain';
import { retainedStates } from '@audiogubbins/history';
import type { StateFingerprint } from '@audiogubbins/project-format';

import { readPair } from './generational-pair.js';
import type { KeptStates } from './history-moves.js';
import { keptStatesOf } from './journal-replay.js';
import { readLease } from './lease-records.js';
import type { ProjectFiles } from './project-files.js';
import { newestHead, sameHead } from './project-heads.js';
import type { ProjectModel } from './project-model.js';
import {
  recoverProject,
  type ProjectRecoveryReport,
  type RecoveryServices,
} from './project-recovery.js';
import { projectMissing, refusalsReported } from './storage-failures.js';

/** A project as it is copied out. */
export interface ProjectCopy {
  readonly project: ProjectId;
  readonly model: ProjectModel;

  /** The states its history keeps that can be read, and how to read one. */
  readonly states: KeptStates;
}

/** How many times a copy is read again after a writer moved the head under it. */
const MOST_READS = 4;

/** Whether a read left out records storage holds. */
function leavesOut(report: ProjectRecoveryReport): boolean {
  return report.journalBreak !== undefined || report.fenced.length > 0;
}

function copyIncomplete(project: ProjectId): DomainFailure {
  return failure(
    'storage.copy-incomplete',
    FailureKind.IntegrityViolation,
    'The project’s most recent changes cannot all be read, so a copy would leave them out. Open the project to see what was found, then try again.',
    { details: { project } },
  );
}

function copyMoving(project: ProjectId): DomainFailure {
  return failure(
    'storage.copy-moving',
    FailureKind.Retryable,
    'The project kept changing while it was read. Try again.',
    { details: { project } },
  );
}

/** Reads a live project as a copy, changing nothing in storage (see the module comment). */
export async function readProjectCopy(
  files: ProjectFiles,
  services: RecoveryServices,
  signal?: AbortSignal,
): Promise<DomainResult<ProjectCopy>> {
  return await refusalsReported(async () => {
    for (let read = 0; read < MOST_READS; read += 1) {
      const header = await readPair(files.records, files.header, signal);
      if (header.valid.length === 0) return fail(projectMissing(files.project));
      const lease = await readLease(files.records, files.paths, signal);
      const recovered = await recoverProject(files, lease.current, services, signal);
      if (!recovered.ok) return recovered;
      const { model, keptStates, unwritten, report } = recovered.value;
      if (!leavesOut(report)) {
        return succeed({
          project: files.project,
          model,
          states: keptStatesOf(files, keptStates, unwritten),
        });
      }
      const now = await newestHead(files.records, files.paths, signal);
      if (sameHead(report.head, now)) return fail(copyIncomplete(files.project));
    }
    return fail(copyMoving(files.project));
  });
}

/** The fingerprints of the states a copy's history keeps that it can offer. */
export function offeredStates(copy: ProjectCopy): readonly StateFingerprint[] {
  return [...retainedStates(copy.model.history)].filter((state) => copy.states.isKept(state));
}
