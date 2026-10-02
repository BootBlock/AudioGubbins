/**
 * The backup generations of a project, as the page asks the storage worker for
 * them: made as its policy says when the page's clock ticks, made on demand,
 * listed, protected, removed, and restored as a new project or in place of the
 * project (REQ-STOR-105, REQ-STOR-106, REQ-STOR-198).
 *
 * The scheduler is the worker's, one for each session open there, so the page
 * names the session and asks it to tick; the backups folder, where the page
 * has one, is lent for the tick. Restoring in place closes the session the
 * page holds first, since the restore opens the project to write itself, as
 * the storage's own restore asks, and the session the restore leaves open is
 * held under a new handle and heard as an opening is; the session closed
 * refuses whatever it is asked after. Where the restore fails, nothing is open
 * here, and the page opens the project again as it was.
 */

import { succeed, type DomainResult, type ProjectId } from '@audiogubbins/domain';
import type {
  BackupGeneration,
  BackupTick,
  ExternalBackupTarget,
  GenerationListing,
  ProjectHeader,
  WriteOutcome,
} from '@audiogubbins/storage';

import type { ProjectHandle } from '../protocol/project-operations.js';
import type { ClientChannel } from '../protocol/storage-operations.js';
import type { LendingCall, Lender } from './page-ports.js';
import { heldUnder } from './remote-opening.js';
import { RemoteProjectSession } from './remote-project.js';

/** Where a generation is restored: as a new project, or in place of the session's. */
export type RestoreTarget =
  | { readonly as: 'new-project'; readonly project: ProjectId }
  | { readonly as: 'replace-current'; readonly session: RemoteProjectSession };

/** What restoring a generation made, as the page holds it. */
export type RemoteRestoredBackup =
  | { readonly kind: 'new-project'; readonly header: ProjectHeader }
  | {
      readonly kind: 'replaced';

      /** The protected generation that holds the project as it was before. */
      readonly previous: BackupGeneration;

      /** The project, open to write as the generation left it. */
      readonly session: RemoteProjectSession;

      /** Whether storage holds it yet: where not, the session says why and retries. */
      readonly saved: WriteOutcome;
    };

/** The backup generations of the projects the page holds. */
export interface BackupsClient {
  /** Makes a generation of the session's project where its policy says one is due now. */
  tick(
    session: RemoteProjectSession,
    folder?: ExternalBackupTarget,
    signal?: AbortSignal,
  ): Promise<DomainResult<BackupTick>>;

  /** Makes a protected generation of the session's project now, as the person asked. */
  backUpNow(
    session: RemoteProjectSession,
    folder?: ExternalBackupTarget,
    signal?: AbortSignal,
  ): Promise<DomainResult<BackupTick>>;
  list(project: ProjectId, signal?: AbortSignal): Promise<DomainResult<GenerationListing>>;

  /** Keeps a generation from pruning, or lets it go as the policy says. */
  protect(project: ProjectId, generation: number, protect: boolean): Promise<DomainResult<void>>;
  remove(
    project: ProjectId,
    generations: readonly number[],
    signal?: AbortSignal,
  ): Promise<DomainResult<void>>;

  /** Restores a generation (see the module comment). */
  restore(
    generation: number,
    target: RestoreTarget,
    signal?: AbortSignal,
  ): Promise<DomainResult<RemoteRestoredBackup>>;
}

/** The tick's argument: the session's handle, and the folder lent where there is one. */
function ticked(session: RemoteProjectSession, folder: ExternalBackupTarget | undefined) {
  return (lend: Lender) => ({
    handle: session.handle,
    ...(folder === undefined ? {} : { folder: lend.backupFolder(folder) }),
  });
}

/** Restores a generation in place of the project `held` writes, under `handle`. */
async function restoreInPlace(
  channel: ClientChannel,
  handle: ProjectHandle,
  generation: number,
  held: RemoteProjectSession,
  signal?: AbortSignal,
): Promise<DomainResult<RemoteRestoredBackup>> {
  const closed = await held.close();
  if (!closed.ok) return closed;
  const { project } = held;
  const restored = await heldUnder(
    channel,
    handle,
    project,
    () => channel.call('backups.restoreInPlace', { handle, project, generation }, { signal }),
    signal,
  );
  if (!restored.ok) return restored;
  const { answer, parts } = restored.value;
  const session = new RemoteProjectSession(parts);
  return succeed({ kind: 'replaced', previous: answer.previous, session, saved: answer.saved });
}

/** The backup generations, over the page's end of the port and calls that lend its ports. */
export function backupsClient(
  channel: ClientChannel,
  call: LendingCall,
  nextHandle: () => ProjectHandle,
): BackupsClient {
  return {
    tick: (session, folder, signal) => call('backups.tick', ticked(session, folder), signal),
    backUpNow: (session, folder, signal) =>
      call('backups.backUpNow', ticked(session, folder), signal),
    list: (project, signal) => channel.call('backups.list', project, { signal }),
    protect: (project, generation, protect) =>
      channel.call('backups.protect', { project, generation, protect }),
    remove: (project, generations, signal) =>
      channel.call('backups.remove', { project, generations }, { signal }),
    restore: async (generation, target, signal) => {
      if (target.as === 'replace-current') {
        return await restoreInPlace(channel, nextHandle(), generation, target.session, signal);
      }
      const { project } = target;
      const header = await channel.call(
        'backups.restoreAsNew',
        { project, generation },
        { signal },
      );
      return header.ok ? succeed({ kind: 'new-project', header: header.value }) : header;
    },
  };
}
