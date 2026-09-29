/**
 * The projects the storage holds: listing them, making a new one, deleting and
 * restoring one, and purging a deleted one for good. The `ProjectRepository`
 * the packet names (REQ-STOR-025, REQ-STOR-102, ADR-0020).
 *
 * Listing reads each project's header and nothing else, one project at a time,
 * in the order of their identifiers, and reports a project whose header cannot
 * be read rather than leaving it out: a project that vanished from the list
 * would look lost. A project still being made, or whose making was cut short,
 * is not listed: it is marked unfinished and has no header yet
 * (`project-creation.ts`). Deleting only marks the header, so a deleted project
 * keeps every state, record and media reference it had until the person purges
 * it, and purging needs the confirmation of the deletion they were shown;
 * purging removes the project's backup generations with it. Each change to a
 * project takes its write lease for the while, so it never races a window
 * writing the same project.
 */

import type { Clock } from '@audiogubbins/diagnostics';
import {
  FailureKind,
  createProject,
  fail,
  failure,
  isWellFormedId,
  mapResult,
  succeed,
  unsafeBrandId,
  type DomainResult,
  type IdGenerator,
  type ProjectId,
  type ProjectSettings,
} from '@audiogubbins/domain';
import {
  emptyProjectState,
  readProjectDocument,
  writeProjectDocument,
  type Digest,
  type StorageTree,
} from '@audiogubbins/project-format';

import { CheckedRecords, type RecordFault } from './checked-records.js';
import { readPair, writeNext } from './generational-pair.js';
import { writeNewProject } from './project-creation.js';
import { ProjectFiles } from './project-files.js';
import { writeHeader, type ProjectHeader } from './project-header.js';
import {
  leaseRefused,
  noCoordination,
  projectMissing,
  refusalsReported,
} from './storage-failures.js';
import { BackupPaths, PROJECTS_DIRECTORY } from './storage-layout.js';
import type { LeaseCoordinator, LeaseOwner } from './write-lease.js';

/** One entry of the list of projects. */
export type CatalogueEntry =
  | { readonly kind: 'project'; readonly header: ProjectHeader }
  | {
      /** Something under the projects directory whose header cannot be read. */
      readonly kind: 'unreadable';
      readonly name: string;
      readonly faults: readonly RecordFault[];
    };

/** What a new project is made with. */
export interface NewProject {
  readonly name: string;
  readonly settings: ProjectSettings;
}

/**
 * The person's confirmation of a purge: the moment the project was deleted, as
 * they were shown it. A confirmation of anything else is refused.
 */
export interface PurgeProjectConfirmation {
  readonly deletedAt: number;
}

/** What the catalogue works with, each made once by the composition root. */
export interface CatalogueServices {
  readonly tree: StorageTree;
  readonly digest: Digest;
  readonly clock: Clock;
  readonly ids: IdGenerator;

  /** The platform's lease coordination, absent where it has none. */
  readonly coordinator?: LeaseCoordinator;
  readonly owner: LeaseOwner;
}

/** The projects the storage holds (see the module comment). */
export class ProjectRepository {
  private readonly services: CatalogueServices;
  private readonly records: CheckedRecords;

  constructor(services: CatalogueServices) {
    this.services = services;
    this.records = new CheckedRecords(services.tree, services.digest);
  }

  /** Every project, deleted ones among them, in the order of their identifiers. */
  async *list(signal?: AbortSignal): AsyncGenerator<CatalogueEntry, void, undefined> {
    for (const entry of await this.services.tree.list(PROJECTS_DIRECTORY)) {
      signal?.throwIfAborted();
      if (entry.kind !== 'directory' || !isWellFormedId(entry.name)) {
        yield { kind: 'unreadable', name: entry.name, faults: [] };
        continue;
      }
      const files = new ProjectFiles(this.records, unsafeBrandId<'ProjectId'>(entry.name));
      const header = await readPair(this.records, files.header, signal);
      const newest = header.valid[0];
      if (newest === undefined && (await files.isUnfinished())) continue;
      yield newest === undefined
        ? { kind: 'unreadable', name: entry.name, faults: header.faults.map(({ fault }) => fault) }
        : { kind: 'project', header: newest.value };
    }
  }

  /** Makes a new, empty project and gives its header. */
  async create(request: NewProject, signal?: AbortSignal): Promise<DomainResult<ProjectHeader>> {
    const name = request.name.trim();
    if (name === '') {
      return fail(failure('project.name-empty', FailureKind.Rejected, 'A project needs a name.'));
    }
    const { ids, clock } = this.services;
    const state = emptyProjectState(createProject(ids.next<'ProjectId'>(), name, request.settings));
    // The document reader is the one authority on what a project may hold, so a
    // name or setting it would refuse is refused here before anything is
    // written that could not be read again.
    const readable = readProjectDocument(writeProjectDocument(state));
    if (!readable.ok) return readable;
    const files = new ProjectFiles(this.records, state.project.id);
    return await refusalsReported(
      async () =>
        await writeNewProject(
          files,
          { state, origin: { kind: 'new' }, at: clock.now() },
          ids,
          signal,
        ),
    );
  }

  /** Deletes a project softly: it is hidden, and everything it holds is kept. */
  async softDelete(project: ProjectId): Promise<DomainResult<ProjectHeader>> {
    const at = this.services.clock.now();
    return await this.rewriteHeader(project, ({ deleted: _kept, ...header }) => ({
      ...header,
      deleted: at,
    }));
  }

  /** Restores a deleted project. */
  async restore(project: ProjectId): Promise<DomainResult<ProjectHeader>> {
    return await this.rewriteHeader(project, ({ deleted: _removed, ...header }) => header);
  }

  /**
   * Removes a deleted project and everything it holds, once the person has
   * confirmed the deletion they were shown. Media it shared stays in the media
   * store until a purge of media finds nothing retains it.
   */
  async purgeProject(
    project: ProjectId,
    confirmation: PurgeProjectConfirmation,
  ): Promise<DomainResult<void>> {
    return await this.whileHeld(project, async (files, header) => {
      if (header.deleted === undefined || header.deleted !== confirmation.deletedAt) {
        return fail(
          failure(
            'storage.purge-unconfirmed',
            FailureKind.Rejected,
            'Only a deleted project is purged, and only as it was when the purge was confirmed.',
          ),
        );
      }
      // The header goes last, so a purge a crash cut short leaves a deleted
      // project that is purged again, never files that belong to nothing.
      const tree = this.services.tree;
      await tree.remove(new BackupPaths(project).directory);
      const headerFiles = new Set([files.paths.header(0), files.paths.header(1)]);
      for (const entry of await tree.list(files.paths.directory)) {
        const path = `${files.paths.directory}/${entry.name}`;
        if (!headerFiles.has(path)) await tree.remove(path);
      }
      await tree.remove(files.paths.directory);
      return succeed(undefined);
    });
  }

  private async rewriteHeader(
    project: ProjectId,
    change: (header: ProjectHeader) => Omit<ProjectHeader, 'generation'>,
  ): Promise<DomainResult<ProjectHeader>> {
    return await this.whileHeld(project, async (files) => {
      const current = await readPair(this.records, files.header);
      const newest = current.valid[0];
      if (newest === undefined) return fail(projectMissing(project));
      const written = await writeNext(this.records, files.header, current, (generation) =>
        writeHeader({ ...change(newest.value), generation }),
      );
      return mapResult(written, ({ value }) => value);
    });
  }

  /** Runs `work` on a project while holding its write lease. */
  private async whileHeld<TValue>(
    project: ProjectId,
    work: (files: ProjectFiles, header: ProjectHeader) => Promise<DomainResult<TValue>>,
  ): Promise<DomainResult<TValue>> {
    const { coordinator, owner } = this.services;
    if (coordinator === undefined) return fail(noCoordination());
    const acquired = await coordinator.acquire(project, { steal: false, owner });
    if (acquired.kind !== 'held') return fail(leaseRefused(acquired, project));
    try {
      const files = new ProjectFiles(this.records, project);
      return await refusalsReported(async () => {
        const newest = (await readPair(this.records, files.header)).valid[0];
        return newest === undefined
          ? fail(projectMissing(project))
          : await work(files, newest.value);
      });
    } finally {
      await acquired.lease.release();
    }
  }
}
