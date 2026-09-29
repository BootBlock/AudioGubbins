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
 */

import { fail, succeed, type DomainResult, type ProjectId } from '@audiogubbins/domain';
import { retainedStates } from '@audiogubbins/history';
import type { StateFingerprint } from '@audiogubbins/project-format';

import { readPair } from './generational-pair.js';
import type { KeptStates } from './history-moves.js';
import { keptStatesOf } from './journal-replay.js';
import { readLease } from './lease-records.js';
import type { ProjectFiles } from './project-files.js';
import type { ProjectModel } from './project-model.js';
import { recoverProject, type RecoveryServices } from './project-recovery.js';
import { projectMissing, refusalsReported } from './storage-failures.js';

/** A project as it is copied out. */
export interface ProjectCopy {
  readonly project: ProjectId;
  readonly model: ProjectModel;

  /** The states its history keeps that can be read, and how to read one. */
  readonly states: KeptStates;
}

/** Reads a live project as a copy, changing nothing in storage. */
export async function readProjectCopy(
  files: ProjectFiles,
  services: RecoveryServices,
  signal?: AbortSignal,
): Promise<DomainResult<ProjectCopy>> {
  return await refusalsReported(async () => {
    const header = await readPair(files.records, files.header, signal);
    if (header.valid.length === 0) return fail(projectMissing(files.project));
    const lease = await readLease(files.records, files.paths, signal);
    const recovered = await recoverProject(files, lease.current, services, signal);
    if (!recovered.ok) return recovered;
    const { model, keptStates, unwritten } = recovered.value;
    return succeed({
      project: files.project,
      model,
      states: keptStatesOf(files, keptStates, unwritten),
    });
  });
}

/** The fingerprints of the states a copy's history keeps that it can offer. */
export function offeredStates(copy: ProjectCopy): readonly StateFingerprint[] {
  return [...retainedStates(copy.model.history)].filter((state) => copy.states.isKept(state));
}
