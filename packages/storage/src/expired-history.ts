/**
 * The cleanup step that compacts the history each project's retention policy
 * lets go: the "user-approved expired history" of the safe order, planned for
 * every project and carried out only once the person confirmed the cleanup
 * (REQ-STOR-106, REQ-STOR-055, REQ-STOR-200).
 *
 * Each project is planned from its newest checkpoint, under the policy it
 * records, with what each plan loses: undoing past a new root, whole branches,
 * the states exports were made from. A project whose policy keeps everything,
 * or lets nothing go, has no plan; nor has a deleted one, whose history waits
 * for its restoring or its purge. Each plan is carried out through a session,
 * which is what writes a project, under its write lease: a project another
 * window writes is passed over and reported, and one whose history has moved on
 * so that its plan no longer fits is left as it is and reported, to be planned
 * again.
 */

import { fail, succeed, type DomainResult, type ProjectId } from '@audiogubbins/domain';
import type { CompactionPlan } from '@audiogubbins/history';

import type { CheckedRecords } from './checked-records.js';
import { planHistoryCompaction } from './history-compaction.js';
import { readPair } from './generational-pair.js';
import { openProject, type OpeningServices } from './project-opening.js';
import { ProjectFiles } from './project-files.js';
import { projectsIn } from './project-listing.js';
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

/** The compaction of each project whose policy lets history go, by project. */
export async function expiredHistory(
  records: CheckedRecords,
  now: number,
  signal?: AbortSignal,
): Promise<ReadonlyMap<ProjectId, CompactionPlan>> {
  const compactions = new Map<ProjectId, CompactionPlan>();
  for (const project of await projectsIn(records.tree, PROJECTS_DIRECTORY)) {
    signal?.throwIfAborted();
    const files = new ProjectFiles(records, project);
    const header = (await readPair(records, files.header, signal)).valid[0];
    if (header === undefined || header.value.deleted !== undefined) continue;
    const checkpoint = await files.newestCheckpoint(signal);
    if (checkpoint === undefined || checkpoint.retention.kind === 'unlimited') continue;
    const plan = await planHistoryCompaction(
      files,
      checkpoint,
      { kind: 'policy', policy: checkpoint.retention },
      now,
      signal,
    );
    if (!plan.ok || plan.value.removable.length === 0) continue;
    compactions.set(project, plan.value);
  }
  return compactions;
}

/** Carries each project's confirmed compaction out through a session of its own. */
export async function compactExpiredHistory(
  compactions: ReadonlyMap<ProjectId, CompactionPlan>,
  services: OpeningServices,
  signal?: AbortSignal,
): Promise<DomainResult<HistoryCompactions>> {
  if (services.coordinator === undefined) return fail(noCoordination());
  let freed = 0;
  const busy: ProjectId[] = [];
  const unapplied: ProjectId[] = [];
  for (const [project, plan] of compactions) {
    signal?.throwIfAborted();
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
    const compacted = await session.compactHistory(plan, {
      reclaimableBytes: plan.reclaimableBytes,
    });
    if (compacted.ok && compacted.value.kind === 'written') freed += plan.reclaimableBytes;
    else unapplied.push(project);
    const closed = await session.close();
    if (!closed.ok) return closed;
  }
  return succeed({ freed, busy, unapplied });
}
