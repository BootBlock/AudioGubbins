/**
 * The cleanup step that compacts the history each project's retention policy
 * lets go: the "user-approved expired history" of the safe order, planned for
 * every project and carried out only once the person confirmed the cleanup
 * (REQ-STOR-106, REQ-STOR-055, REQ-STOR-200).
 *
 * Each project is planned as recovery reads it, from its newest checkpoint and
 * every journal record after it, so under the policy it holds now, with what
 * each plan loses: undoing past a new root, whole branches, the states exports
 * were made from. A project whose policy keeps everything, or lets nothing go,
 * has no plan; nor has a deleted one, whose history waits for its restoring or
 * its purge. Each plan is carried out through a session, which is what writes a
 * project, under its write lease: a project another window writes is passed
 * over and reported, and one whose history has moved on so that its plan no
 * longer fits is left as it is and reported, to be planned again. The project
 * the running window writes is compacted through the session it already has,
 * which holds the lease a session of its own would ask for.
 */

import { fail, succeed, type DomainResult, type ProjectId } from '@audiogubbins/domain';
import type { CompactionPlan } from '@audiogubbins/history';
import type { Turns } from '@audiogubbins/project-format';

import type { CheckedRecords } from './checked-records.js';
import { planHistoryCompaction } from './history-compaction.js';
import { readPair } from './generational-pair.js';
import { openProject, type OpeningServices } from './project-opening.js';
import type { ProjectSession } from './project-session.js';
import { readProjectCopy } from './project-copy.js';
import { ProjectFiles } from './project-files.js';
import { projectsIn } from './project-listing.js';
import type { RecoveryServices } from './project-recovery.js';
import { noCoordination } from './storage-failures.js';
import { PROJECTS_DIRECTORY } from './storage-layout.js';

/** What carrying the step out did. */
export interface HistoryCompactions {
  readonly freed: number;

  /** The projects another window writes, passed over. */
  readonly busy: readonly ProjectId[];

  /** The projects whose plan no longer fits their history, left as they were. */
  readonly unapplied: readonly ProjectId[];
}

/**
 * The compaction of each project whose policy lets history go, by project. A
 * project that cannot be read whole has none.
 */
export async function expiredHistory(
  records: CheckedRecords,
  services: RecoveryServices,
  now: number,
  turns: Turns,
): Promise<ReadonlyMap<ProjectId, CompactionPlan>> {
  const { signal } = turns;
  const compactions = new Map<ProjectId, CompactionPlan>();
  for (const project of await projectsIn(records.tree, PROJECTS_DIRECTORY)) {
    signal?.throwIfAborted();
    const files = new ProjectFiles(records, project);
    const header = (await readPair(records, files.header, signal)).valid[0];
    if (header === undefined || header.value.deleted !== undefined) continue;
    const copy = await readProjectCopy(files, services, signal);
    if (!copy.ok) continue;
    const { model } = copy.value;
    if (model.retention.kind === 'unlimited') continue;
    const plan = await planHistoryCompaction(
      files,
      model,
      { kind: 'policy', policy: model.retention },
      now,
      turns,
    );
    if (!plan.ok || plan.value.removable.length === 0) continue;
    compactions.set(project, plan.value);
  }
  return compactions;
}

/**
 * Carries each project's confirmed compaction out through a session of its
 * own, or through `held` for the project it writes.
 */
export async function compactExpiredHistory(
  compactions: ReadonlyMap<ProjectId, CompactionPlan>,
  services: OpeningServices,
  held: ProjectSession | undefined,
  signal?: AbortSignal,
): Promise<DomainResult<HistoryCompactions>> {
  if (services.coordinator === undefined) return fail(noCoordination());
  let freed = 0;
  const busy: ProjectId[] = [];
  const unapplied: ProjectId[] = [];
  const compactedBy = async (session: ProjectSession, plan: CompactionPlan): Promise<void> => {
    const compacted = await session.compactHistory(plan, {
      reclaimableBytes: plan.reclaimableBytes,
    });
    if (compacted.ok && compacted.value.kind === 'written') freed += plan.reclaimableBytes;
    else unapplied.push(session.project);
  };
  for (const [project, plan] of compactions) {
    signal?.throwIfAborted();
    if (held?.project === project) {
      if (held.getSnapshot().access.kind === 'writable') await compactedBy(held, plan);
      else busy.push(project);
      continue;
    }
    const opened = await openProject(
      { project, access: 'write', ...(signal === undefined ? {} : { signal }) },
      services,
    );
    if (!opened.ok) return opened;
    if (opened.value.kind !== 'writable') {
      const { view } = opened.value;
      view.close();
      const { access } = view.getSnapshot();
      if (access.kind === 'read-only' && access.reason.kind === 'no-coordination') {
        return fail(noCoordination());
      }
      busy.push(project);
      continue;
    }
    const { session } = opened.value;
    await compactedBy(session, plan);
    const closed = await session.close();
    if (!closed.ok) return closed;
  }
  return succeed({ freed, busy, unapplied });
}
