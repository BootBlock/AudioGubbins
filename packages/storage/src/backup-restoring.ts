/**
 * Restoring a project from one of its backup generations, as a new project or
 * in place of the project as it is (REQ-STOR-105, REQ-STOR-198).
 *
 * As a new project, the generation's state, history and export log become a
 * project of their own under a new identity, as a copy brought in from a bundle
 * does, and the project it was made of is not touched. In place, the project is
 * opened to write, so no other window writes it meanwhile, and before anything
 * of it is replaced, the project as storage holds it is made a protected backup
 * generation of its own, which pruning never removes: the replacement is no
 * change the history can undo, and the outcome names the generation that brings
 * back what it replaced. Only then does the project become the generation's,
 * history and all, written as one checkpoint, so a crash before it lands leaves
 * the project as it was; the project stays open to write, as the generation
 * left it, and the session says whether storage holds it yet. Media is not
 * copied in either case: the generation names it by content, and the store kept
 * it. The states the generation keeps are read one at a time as they are
 * written, so a long history is never held whole (REQ-EXEC-216).
 */

import type { Clock } from '@audiogubbins/diagnostics';
import { fail, succeed, type DomainResult, type ProjectId } from '@audiogubbins/domain';
import { historyRecordOf } from '@audiogubbins/history';
import { Turns } from '@audiogubbins/project-format';

import { BackupGenerations } from './backup-generations.js';
import type { BackupGeneration } from './backup-planning.js';
import { CheckedRecords } from './checked-records.js';
import { choiceOf } from './comparison-record.js';
import { readProjectCopy, type ProjectCopy } from './project-copy.js';
import { writeProject } from './project-creation.js';
import { ProjectFiles } from './project-files.js';
import type { ProjectHeader } from './project-header.js';
import { movedHistory, stateOf } from './project-identity.js';
import { openProject, type OpeningServices } from './project-opening.js';
import type { ProjectSession } from './project-session.js';
import { noCoordination, projectBusy, refusalsReported } from './storage-failures.js';
import type { WriteOutcome } from './write-queue.js';
import { copiedStates } from './tree-content.js';

/** Where a generation is restored to. */
export type RestoreTarget = 'new-project' | 'replace-current';

/** What restoring a generation made. */
export type RestoredBackup =
  | { readonly kind: 'new-project'; readonly header: ProjectHeader }
  | {
      readonly kind: 'replaced';

      /** The protected generation that holds the project as it was before. */
      readonly previous: BackupGeneration;

      /** The project, open to write as the generation left it. */
      readonly session: ProjectSession;

      /** Whether storage holds it yet: where not, the session says why and retries. */
      readonly saved: WriteOutcome;
    };

/** What restoring works with, each made once by the composition root. */
export interface RestoreServices extends OpeningServices {
  readonly clock: Clock;
}

/** Restores a backup generation (see the module comment). */
export async function restoreBackup(
  project: ProjectId,
  generation: number,
  options: { readonly as: RestoreTarget },
  services: RestoreServices,
  signal?: AbortSignal,
): Promise<DomainResult<RestoredBackup>> {
  const generations = new BackupGenerations(services.tree, services.digest, project);
  const copy = await generations.copyOf(generation, signal);
  if (!copy.ok) return copy;
  return options.as === 'new-project'
    ? await asNewProject(copy.value, services, signal)
    : await inPlace(copy.value, generations, services, signal);
}

async function asNewProject(
  copy: ProjectCopy,
  services: RestoreServices,
  signal?: AbortSignal,
): Promise<DomainResult<RestoredBackup>> {
  const states = copiedStates(copy);
  if (!states.ok) return states;
  const { model } = copy;
  const project = services.ids.next<'ProjectId'>();
  const turns = new Turns(services.yieldToHost, signal);
  const record = historyRecordOf(model.history);
  const moved = movedHistory({ record, retention: model.retention, states: states.value }, project);
  if (!moved.ok) return moved;
  const files = new ProjectFiles(new CheckedRecords(services.tree, services.digest), project);
  const written = await refusalsReported(
    async () =>
      await writeProject(
        files,
        {
          state: stateOf(model.state, project),
          ...moved.value,
          exports: model.exports,
          retention: model.retention,
          backup: model.backup,
          ...(model.comparison === undefined ? {} : { comparison: choiceOf(model.comparison) }),
          created: services.clock.now(),
        },
        { ids: services.ids, turns, coordinator: services.coordinator },
      ),
  );
  return written.ok ? succeed({ kind: 'new-project', header: written.value }) : written;
}

async function inPlace(
  copy: ProjectCopy,
  generations: BackupGenerations,
  services: RestoreServices,
  signal?: AbortSignal,
): Promise<DomainResult<RestoredBackup>> {
  const states = copiedStates(copy);
  if (!states.ok) return states;
  const opened = await openProject(
    { project: copy.project, access: 'write', ...(signal === undefined ? {} : { signal }) },
    services,
  );
  if (!opened.ok) return opened;
  if (opened.value.kind !== 'writable') {
    const { view } = opened.value;
    view.close();
    const { access } = view.getSnapshot();
    return fail(
      access.kind === 'read-only' && access.reason.kind === 'no-coordination'
        ? noCoordination()
        : projectBusy(copy.project),
    );
  }
  const { session } = opened.value;
  const files = new ProjectFiles(new CheckedRecords(services.tree, services.digest), copy.project);
  const current = await readProjectCopy(files, services, signal);
  const previous = current.ok
    ? await generations.create(
        current.value,
        { reason: 'manual', at: services.clock.now(), protect: true },
        new Turns(services.yieldToHost, signal),
        services.coordinator,
      )
    : current;
  // Until the project is replaced nothing of it changed, so the session closes
  // with nothing to save.
  if (!previous.ok) {
    await session.close();
    return previous;
  }
  const replaced = await session.replaceProject(copy.model, states.value, signal);
  if (!replaced.ok) {
    await session.close();
    return replaced;
  }
  return succeed({ kind: 'replaced', previous: previous.value, session, saved: replaced.value });
}
