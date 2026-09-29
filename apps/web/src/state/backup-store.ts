/**
 * The backup generations of the project open in this window: made as its policy
 * says whenever the application's clock ticks, made on demand and protected,
 * listed, and restored as a new project or in place of the project
 * (REQ-STOR-105, REQ-STOR-106, REQ-STOR-198).
 *
 * The storage keeps no timer, so the composition root ticks this store and the
 * scheduler decides whether a generation is due. Only the window writing a
 * project makes its generations; a window reading it lists them. Restoring in
 * place closes the project here first, since the restore opens it to write
 * itself, and the session the restore leaves open becomes the open project;
 * where the restore fails, the project is opened again as it was. A backup is
 * also copied to the backups folder where the project's policy asks, and what
 * became of the latest copy is kept to be shown beside the backups.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainResult,
  type ProjectId,
} from '@audiogubbins/domain';
import type { BackupPolicy } from '@audiogubbins/project-format';
import {
  BackupGenerations,
  BackupScheduler,
  restoreBackup,
  type BackupGeneration,
  type BackupTick,
  type ExternalBackupTarget,
  type ExternalCopy,
  type ProjectSession,
  type RestoreTarget,
  type RestoredBackup,
  type WriteOutcome,
} from '@audiogubbins/storage';

import type { ProjectServices } from '../storage/project-services.js';
import { observable, type Observable } from './observable.js';
import type { OpenProjectStore } from './open-project-store.js';
import type { ProjectLibraryStore } from './project-library-store.js';

/** The open project's generations, and what is being done with them. */
export interface BackupState {
  readonly project?: ProjectId;

  /** The whole generations, newest first. */
  readonly generations: readonly BackupGeneration[];
  readonly working?: 'backing-up' | 'restoring';

  /** Why the generations could not be listed the last time, where they could not. */
  readonly problem?: string;

  /** What became of the latest copy to the backups folder, where one was asked for. */
  readonly copied?: Exclude<ExternalCopy, { readonly kind: 'not-asked' }>;
}

/** Why a backup cannot be made or changed here. */
const NOT_WRITABLE = failure(
  'backup.not-writable',
  FailureKind.Conflict,
  'Backups are made only of a project this tab can change.',
);

/** The open project's backups (see the module comment). */
export class BackupStore implements Observable<BackupState> {
  private readonly services: ProjectServices;
  private readonly project: OpenProjectStore;
  private readonly library: ProjectLibraryStore;
  private readonly folder: ExternalBackupTarget;
  private readonly state = observable<BackupState>({ generations: [] });
  private scheduler:
    { readonly session: ProjectSession; readonly made: BackupScheduler } | undefined;

  readonly get = this.state.get;
  readonly subscribe = this.state.subscribe;

  constructor(
    services: ProjectServices,
    project: OpenProjectStore,
    library: ProjectLibraryStore,
    folder: ExternalBackupTarget,
  ) {
    this.services = services;
    this.project = project;
    this.library = library;
    this.folder = folder;
    project.subscribe(() => {
      this.follow();
    });
  }

  /** Makes a generation where the policy says one is due, as the clock ticks. */
  readonly tick = async (): Promise<void> => {
    const session = this.project.session();
    const made = this.schedulerNow();
    if (made === undefined || session === undefined) return;
    const ticked = await made.tick(this.services.clock.now(), session.getSnapshot().model);
    if (!ticked.ok) {
      this.services.logger.warning('A scheduled backup was not made.', {
        code: ticked.failures[0].code,
      });
    } else if (ticked.value.kind === 'made') {
      this.noteCopy(ticked.value.external);
      await this.list(session.project);
    }
  };

  /** Makes a protected generation now, as the person asked. */
  readonly backUpNow = (): Promise<DomainResult<BackupTick>> =>
    this.whileWorking('backing-up', async () => {
      const session = this.project.session();
      const made = this.schedulerNow();
      if (made === undefined || session === undefined) return fail(NOT_WRITABLE);
      const done = await made.backUpNow(this.services.clock.now(), session.getSnapshot().model);
      if (done.ok && done.value.kind === 'made') this.noteCopy(done.value.external);
      return done;
    });

  /** Restores a generation as a new project, or in place of the project open. */
  readonly restore = (
    generation: number,
    target: RestoreTarget,
  ): Promise<DomainResult<RestoredBackup>> =>
    this.whileWorking('restoring', async () => {
      const { project: id } = this.state.get();
      if (id === undefined || this.project.session() === undefined) return fail(NOT_WRITABLE);
      if (target === 'replace-current') return await this.restoreInPlace(id, generation);
      const restored = await restoreBackup(id, generation, { as: 'new-project' }, this.services);
      await this.library.refresh();
      return restored;
    });

  /** Keeps a generation from pruning, or lets it go as the policy says. */
  readonly protect = async (generation: number, keep: boolean): Promise<DomainResult<void>> => {
    const session = this.project.session();
    if (session === undefined) return fail(NOT_WRITABLE);
    const { tree, digest } = this.services;
    const done = await new BackupGenerations(tree, digest, session.project).protect(
      generation,
      keep,
    );
    await this.list(session.project);
    return done.ok ? succeed(undefined) : done;
  };

  /** Sets when the open project is backed up on its own. */
  readonly setPolicy = async (policy: BackupPolicy): Promise<DomainResult<WriteOutcome>> => {
    const session = this.project.session();
    return session === undefined ? fail(NOT_WRITABLE) : await session.setBackupPolicy(policy);
  };

  /** Keeps what became of a copy to the backups folder, where one was asked for. */
  private noteCopy(copy: ExternalCopy): void {
    if (copy.kind === 'not-asked') return;
    this.state.update((current) => ({ ...current, copied: copy }));
    if (copy.kind === 'failed') {
      this.services.logger.warning('A backup was not copied to the backups folder.', {
        code: copy.failure.code,
      });
    }
  }

  /** Lists the generations of a project opened in place of another. */
  private follow(): void {
    const open = this.project.get();
    const id = open.kind === 'open' ? open.snapshot.project : undefined;
    if (id === this.state.get().project) return;
    this.state.set(id === undefined ? { generations: [] } : { project: id, generations: [] });
    if (id !== undefined) void this.list(id);
  }

  private async list(id: ProjectId): Promise<void> {
    const { tree, digest } = this.services;
    const listed = await new BackupGenerations(tree, digest, id).list();
    if (this.state.get().project !== id) return;
    this.state.update(({ problem: _earlier, ...rest }) =>
      listed.ok
        ? { ...rest, generations: listed.value.generations }
        : { ...rest, problem: listed.failures[0].summary },
    );
  }

  /** The scheduler of the session open to write now, made once for it. */
  private schedulerNow(): BackupScheduler | undefined {
    const session = this.project.session();
    if (session === undefined) return undefined;
    if (this.scheduler?.session !== session) {
      this.scheduler = {
        session,
        made: new BackupScheduler(session.project, this.services, this.folder),
      };
    }
    return this.scheduler.made;
  }

  private async whileWorking<TValue>(
    doing: NonNullable<BackupState['working']>,
    work: () => Promise<DomainResult<TValue>>,
  ): Promise<DomainResult<TValue>> {
    this.state.update((current) => ({ ...current, working: doing }));
    try {
      return await work();
    } finally {
      this.state.update(({ working: _done, ...rest }) => rest);
      const { project: id } = this.state.get();
      if (id !== undefined) await this.list(id);
    }
  }

  /**
   * Restores in place: the project here is closed first, since the restore
   * opens it to write itself, and the session it leaves becomes the open
   * project; where it fails, the project is opened again as it was.
   */
  private async restoreInPlace(
    id: ProjectId,
    generation: number,
  ): Promise<DomainResult<RestoredBackup>> {
    const closed = await this.project.close();
    if (!closed.ok) return closed;
    const restored = await restoreBackup(id, generation, { as: 'replace-current' }, this.services);
    if (restored.ok && restored.value.kind === 'replaced')
      this.project.adopt(restored.value.session);
    else await this.project.open(id);
    return restored;
  }
}
