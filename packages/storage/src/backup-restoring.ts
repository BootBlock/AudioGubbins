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
 * it.
 */

import type { Clock } from '@audiogubbins/diagnostics';
import { fail, succeed, type DomainResult, type ProjectId } from '@audiogubbins/domain';
import { historyFromRecord, historyRecordOf } from '@audiogubbins/history';
import { Turns, type ProjectTreeContent } from '@audiogubbins/project-format';

import { BackupGenerations } from './backup-generations.js';
import type { BackupGeneration } from './backup-planning.js';
import { CheckedRecords } from './checked-records.js';
import { choiceOf } from './comparison-record.js';
import { readProjectCopy, type ProjectCopy } from './project-copy.js';
import { writeProject } from './project-creation.js';
import { ProjectFiles } from './project-files.js';
import type { ProjectHeader } from './project-header.js';
import { contentAs } from './project-identity.js';
import { openProject, type OpeningServices } from './project-opening.js';
import type { ProjectSession } from './project-session.js';
import { noCoordination, projectBusy, refusalsReported } from './storage-failures.js';
import type { WriteOutcome } from './write-queue.js';
import { loadedStatesOf } from './tree-content.js';

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
  const states = await loadedStatesOf(copy, signal);
  if (!states.ok) return states;
  const { model } = copy;
  const content: ProjectTreeContent = {
    state: model.state,
    scope: {
      kind: 'history',
      history: {
        record: historyRecordOf(model.history),
        retention: model.retention,
        states: states.value,
        ...(model.comparison === undefined ? {} : { comparison: choiceOf(model.comparison) }),
      },
    },
    exports: model.exports,
    backup: model.backup,
    media: [],
  };
  const project = services.ids.next<'ProjectId'>();
  const moved = await contentAs(content, project, services.digest);
  const { scope } = moved;
  if (scope.kind !== 'history') throw new Error('A restored history lost its history.');
  const history = historyFromRecord(scope.history.record);
  if (!history.ok) return history;
  const files = new ProjectFiles(new CheckedRecords(services.tree, services.digest), project);
  const written = await refusalsReported(
    async () =>
      await writeProject(
        files,
        {
          state: moved.state,
          history: history.value,
          kept: scope.history.states,
          exports: moved.exports,
          retention: model.retention,
          backup: model.backup,
          ...(scope.history.comparison === undefined
            ? {}
            : { comparison: scope.history.comparison }),
          created: services.clock.now(),
        },
        services.ids,
        new Turns(services.yieldToHost, signal),
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
  const states = await loadedStatesOf(copy, signal);
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
      )
    : current;
  // Until the project is replaced nothing of it changed, so the session closes
  // with nothing to save.
  if (!previous.ok) {
    await session.close();
    return previous;
  }
  const replaced = await session.replaceProject(copy.model, states.value);
  if (!replaced.ok) {
    await session.close();
    return replaced;
  }
  return succeed({ kind: 'replaced', previous: previous.value, session, saved: replaced.value });
}
