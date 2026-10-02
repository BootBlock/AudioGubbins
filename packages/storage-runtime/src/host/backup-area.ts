/**
 * A project's backup generations, served to the page: the scheduler of each
 * session open in the worker, made once for it and ticked as the page asks,
 * and the generations listed, protected, removed and restored (REQ-STOR-105,
 * REQ-STOR-106, REQ-STOR-198).
 *
 * A scheduler is kept for as long as its session is, so a session restored in
 * place of the project, being another, has a scheduler of its own. It runs one
 * tick at a time, and its copy to the backups folder writes through the folder
 * the page lent for the tick that made it; with none lent, a copy the policy
 * asks for fails as a folder that cannot be reached, as the page's own does
 * while it may not be written. A generation restored in place leaves its
 * session open under the handle the page named, sent as an opening is; one the
 * page abandoned meanwhile is closed rather than left holding the lease.
 */

import { succeed, type DomainResult, type ProjectId } from '@audiogubbins/domain';
import { TreeFailure, TreeFailureKind } from '@audiogubbins/project-format';
import {
  BackupGenerations,
  BackupScheduler,
  restoreBackup,
  type BackupTick,
  type ExternalBackupTarget,
  type ProjectSession,
} from '@audiogubbins/storage';

import type { PagePort } from '../protocol/page-operations.js';
import type { ProjectHandle } from '../protocol/project-operations.js';
import type { AreaHandlers, HostChannel } from '../protocol/storage-operations.js';
import type { HostServices } from './host-services.js';
import type { OpenProjects } from './open-projects.js';
import { letGo } from './project-area.js';
import { pageBackupFolder } from './remote-page-ports.js';

/** A session's scheduler, the folder lent for the tick it runs, and whether one runs. */
interface Scheduled {
  readonly scheduler: BackupScheduler;
  folder: ExternalBackupTarget | undefined;
  running: boolean;
}

const NO_FOLDER = 'No backups folder was offered to write the copy into.';

/** The schedulers of the sessions open, each made as it is first ticked. */
function schedulersOf(services: HostServices): (session: ProjectSession) => Scheduled {
  const made = new WeakMap<ProjectSession, Scheduled>();
  return (session) => {
    const known = made.get(session);
    if (known !== undefined) return known;
    const external: ExternalBackupTarget = {
      create: async (generation) => {
        if (scheduled.folder === undefined) {
          throw new TreeFailure(TreeFailureKind.Unavailable, NO_FOLDER);
        }
        return await scheduled.folder.create(generation);
      },
    };
    const scheduled: Scheduled = {
      scheduler: new BackupScheduler(session.project, services, external),
      folder: undefined,
      running: false,
    };
    made.set(session, scheduled);
    return scheduled;
  };
}

/** The backup operations, over the worker's services, its open projects and the page's ports. */
export function backupHandlers(
  services: HostServices,
  projects: OpenProjects,
  channel: HostChannel,
): AreaHandlers<'backups'> {
  const schedulerOf = schedulersOf(services);
  const generations = (project: ProjectId): BackupGenerations =>
    new BackupGenerations(services.tree, services.digest, project);
  // Runs a tick of the session under `handle`, one at a time, with the folder
  // lent for it.
  const ticking = async (
    handle: ProjectHandle,
    folder: PagePort | undefined,
    tick: (
      scheduler: BackupScheduler,
      session: ProjectSession,
    ) => Promise<DomainResult<BackupTick>>,
  ): Promise<DomainResult<BackupTick>> => {
    const session = projects.session(handle);
    const scheduled = schedulerOf(session);
    // The scheduler would answer busy too, but the folder lent belongs to the
    // tick that runs, so a second is answered before it can take its place.
    if (scheduled.running) return succeed({ kind: 'busy' });
    scheduled.running = true;
    scheduled.folder = folder === undefined ? undefined : pageBackupFolder(channel, folder);
    try {
      return await tick(scheduled.scheduler, session);
    } finally {
      scheduled.running = false;
      scheduled.folder = undefined;
    }
  };
  return {
    'backups.tick': ({ handle, folder }, { signal }) =>
      ticking(handle, folder, (scheduler, session) =>
        scheduler.tick(services.clock.now(), session.getSnapshot().model, signal),
      ),
    'backups.backUpNow': ({ handle, folder }, { signal }) =>
      ticking(handle, folder, (scheduler, session) =>
        scheduler.backUpNow(services.clock.now(), session.getSnapshot().model, signal),
      ),
    'backups.list': (project, { signal }) => generations(project).list(signal),
    'backups.protect': ({ project, generation, protect }) =>
      generations(project).protect(generation, protect),
    'backups.remove': ({ project, generations: numbers }, { signal }) =>
      generations(project).remove(numbers, signal),
    ...restoreHandlers(services, projects),
  };
}

/** Restoring generations, as a new project or in place of the project. */
function restoreHandlers(
  services: HostServices,
  projects: OpenProjects,
): Pick<AreaHandlers<'backups'>, 'backups.restoreAsNew' | 'backups.restoreInPlace'> {
  return {
    'backups.restoreAsNew': async ({ project, generation }, { signal }) => {
      const restored = await restoreBackup(
        project,
        generation,
        { as: 'new-project' },
        services,
        signal,
      );
      if (!restored.ok) return restored;
      if (restored.value.kind !== 'new-project')
        throw new Error('A restore as new replaced the project.');
      return succeed(restored.value.header);
    },
    'backups.restoreInPlace': async ({ handle, project, generation }, { signal }) => {
      const restored = await restoreBackup(
        project,
        generation,
        { as: 'replace-current' },
        services,
        signal,
      );
      if (!restored.ok) return restored;
      if (restored.value.kind !== 'replaced')
        throw new Error('A restore in place made a new project.');
      const { session, previous, saved } = restored.value;
      if (signal.aborted) {
        await letGo({ kind: 'writable', session }, services.logger);
        signal.throwIfAborted();
      }
      return succeed({ previous, saved, ...projects.hold(handle, { kind: 'writable', session }) });
    },
  };
}
