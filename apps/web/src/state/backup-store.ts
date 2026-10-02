/**
 * The backup generations of the project open in this window: made as its policy
 * says whenever the application's clock ticks, made on demand and protected,
 * listed, and restored as a new project or in place of the project
 * (REQ-STOR-105, REQ-STOR-106, REQ-STOR-198).
 *
 * The storage keeps no timer, so the composition root ticks this store and the
 * storage worker's scheduler for the session decides whether a generation is
 * due. Only the window writing a project makes its generations; a window
 * reading it lists them. Restoring in place closes the project here first,
 * since the restore opens it to write itself, and the session the restore
 * leaves open becomes the open project; where the restore fails once it closed
 * the project, the project is opened again as it was. A backup is also copied
 * to the backups folder where the project's policy asks, which the page lends
 * the worker for each backup, and what became of the latest copy is kept to be
 * shown beside the backups. A backup the policy asked for that was not made is
 * kept, with why, until one is made, so the status bar can say so: the person
 * relies on backups they never see being made. The work done for a project is
 * given up once it is let go, and a listing once a newer one replaces it.
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
import type {
  BackupGeneration,
  BackupTick,
  ExternalBackupTarget,
  ExternalCopy,
  WriteOutcome,
} from '@audiogubbins/storage';
import type {
  BackupsClient,
  RemoteProjectSession,
  RemoteRestoredBackup,
  RestoreTarget,
} from '@audiogubbins/storage-runtime';

import type { ProjectServices } from '../storage/project-services.js';
import { Requests, isAbandoned } from './abandoning.js';
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

  /** Why the last backup the policy asked for was not made, until one is made. */
  readonly missed?: string;
}

/** Where a generation is restored: as a new project, or in place of the project open. */
export type RestoreChoice = RestoreTarget['as'];

/** Why a backup cannot be made or changed here. */
const NOT_WRITABLE = failure(
  'backup.not-writable',
  FailureKind.Conflict,
  'Backups are made only of a project this tab can change.',
);

/** The open project's backups (see the module comment). */
export class BackupStore implements Observable<BackupState> {
  private readonly backups: BackupsClient;
  private readonly services: ProjectServices;
  private readonly lifetime: AbortSignal;
  private readonly project: OpenProjectStore;
  private readonly library: ProjectLibraryStore;
  private readonly folder: ExternalBackupTarget;
  private readonly listings: Requests;
  private readonly state = observable<BackupState>({ generations: [] });

  readonly get = this.state.get;
  readonly subscribe = this.state.subscribe;

  /**
   * The open project's backups, copied through `folder`, the store's work
   * ending once `lifetime` aborts.
   */
  constructor(
    services: ProjectServices,
    lifetime: AbortSignal,
    project: OpenProjectStore,
    library: ProjectLibraryStore,
    folder: ExternalBackupTarget,
  ) {
    this.backups = services.client.backups;
    this.services = services;
    this.lifetime = lifetime;
    this.project = project;
    this.library = library;
    this.folder = folder;
    this.listings = new Requests(() => project.scope());
    project.subscribe(() => {
      this.follow();
    });
  }

  /** Makes a generation where the policy says one is due, as the clock ticks. */
  readonly tick = async (): Promise<void> => {
    const session = this.project.session();
    if (session === undefined) return;
    const ticked = await this.backups.tick(session, this.folder, this.project.scope());
    if (!ticked.ok) {
      const [cause] = ticked.failures;
      this.services.logger.warning('A scheduled backup was not made.', { code: cause.code });
      if (this.state.get().missed !== cause.summary) {
        this.state.update((current) => ({ ...current, missed: cause.summary }));
      }
    } else if (ticked.value.kind === 'made') {
      this.noteMade(ticked.value.external);
      await this.list(session.project);
    }
  };

  /** Makes a protected generation now, as the person asked. */
  readonly backUpNow = (): Promise<DomainResult<BackupTick>> =>
    this.whileWorking('backing-up', async () => {
      const session = this.project.session();
      if (session === undefined) return fail(NOT_WRITABLE);
      const done = await this.backups.backUpNow(session, this.folder, this.project.scope());
      if (done.ok && done.value.kind === 'made') this.noteMade(done.value.external);
      return done;
    });

  /** Restores a generation as a new project, or in place of the project open. */
  readonly restore = (
    generation: number,
    target: RestoreChoice,
  ): Promise<DomainResult<RemoteRestoredBackup>> =>
    this.whileWorking('restoring', async () => {
      const { project: id } = this.state.get();
      const session = this.project.session();
      if (id === undefined || session === undefined) return fail(NOT_WRITABLE);
      if (target === 'replace-current') return await this.restoreInPlace(session, generation);
      const restored = await this.backups.restore(
        generation,
        { as: 'new-project', project: id },
        this.lifetime,
      );
      await this.library.refresh();
      return restored;
    });

  /** Keeps a generation from pruning, or lets it go as the policy says. */
  readonly protect = async (generation: number, keep: boolean): Promise<DomainResult<void>> => {
    const session = this.project.session();
    if (session === undefined) return fail(NOT_WRITABLE);
    const done = await this.backups.protect(session.project, generation, keep);
    await this.list(session.project);
    return done.ok ? succeed(undefined) : done;
  };

  /** Removes a generation the person chose to delete, protected or not. */
  readonly remove = async (generation: number): Promise<DomainResult<void>> => {
    const session = this.project.session();
    if (session === undefined) return fail(NOT_WRITABLE);
    const done = await this.backups.remove(session.project, [generation], this.project.scope());
    await this.list(session.project);
    return done;
  };

  /** Sets when the open project is backed up on its own. */
  readonly setPolicy = async (policy: BackupPolicy): Promise<DomainResult<WriteOutcome>> => {
    const session = this.project.session();
    return session === undefined ? fail(NOT_WRITABLE) : await session.setBackupPolicy(policy);
  };

  /**
   * Keeps what became of a backup's copy to the backups folder, where one was
   * asked for, and forgets a backup missed, since one is made now.
   */
  private noteMade(copy: ExternalCopy): void {
    this.state.update(({ missed: _made, ...current }) =>
      copy.kind === 'not-asked' ? current : { ...current, copied: copy },
    );
    if (copy.kind === 'not-asked') return;
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
    if (id === undefined) return;
    this.list(id).catch((error: unknown) => {
      this.services.logger.error('The backups of a project could not be listed.', {
        reason: error instanceof Error ? error.message : 'unknown',
      });
    });
  }

  /**
   * Lists a project's generations, and settles at once where a newer listing,
   * or letting the project go, gives this one up.
   */
  private async list(id: ProjectId): Promise<void> {
    const signal = this.listings.next();
    let listed: Awaited<ReturnType<BackupsClient['list']>>;
    try {
      listed = await this.backups.list(id, signal);
    } catch (error) {
      if (signal.aborted && isAbandoned(error)) return;
      throw error;
    }
    if (this.state.get().project !== id) return;
    this.state.update(({ problem: _earlier, ...rest }) =>
      listed.ok
        ? { ...rest, generations: listed.value.generations }
        : { ...rest, problem: listed.failures[0].summary },
    );
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
   * Restores in place: the session here is closed first, since the restore
   * opens the project to write itself, and the session it leaves becomes the
   * open project; where it fails once it closed the session, the project is
   * opened again as it was.
   */
  private async restoreInPlace(
    session: RemoteProjectSession,
    generation: number,
  ): Promise<DomainResult<RemoteRestoredBackup>> {
    let restored: DomainResult<RemoteRestoredBackup> | undefined;
    try {
      restored = await this.backups.restore(
        generation,
        { as: 'replace-current', session },
        this.lifetime,
      );
      if (restored.ok && restored.value.kind === 'replaced') {
        this.project.adopt(restored.value.session);
      }
      return restored;
    } finally {
      if (restored?.ok !== true && session.getSnapshot().access.kind === 'closed') {
        await this.project.open(session.project);
      }
    }
  }
}
