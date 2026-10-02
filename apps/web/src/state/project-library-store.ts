/**
 * The projects this browser keeps, as the interface lists them, and the changes
 * to the list: making, deleting, restoring and purging a project, and forking
 * one (REQ-STOR-026, REQ-STOR-102, REQ-STOR-199).
 *
 * The list is read again after every change, from the catalogue the storage
 * worker keeps, which is the one authority on what the storage holds; a project
 * brought in from outside is `project-transfer-store.ts`'s, which reads the
 * list again here after. A reading replaced by a newer one is given up, since
 * the newer one shows the list. The list says what change is running while one
 * is.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainResult,
  type ProjectId,
} from '@audiogubbins/domain';
import { TreeFailure } from '@audiogubbins/project-format';
import type { CatalogueEntry, ForkRequest, NewProject, ProjectHeader } from '@audiogubbins/storage';
import type { LibraryClient } from '@audiogubbins/storage-runtime';

import { quoted } from '../wording.js';
import { Requests, isAbandoned } from './abandoning.js';
import { observable, type Observable } from './observable.js';

/** The projects kept, and what is being done to them. */
export interface LibraryState {
  /** Every project, deleted ones among them, and anything whose header cannot be read. */
  readonly entries: readonly CatalogueEntry[];

  /** Whether the list has been read yet. */
  readonly loaded: boolean;

  /** What is being done, in a phrase, while something is. */
  readonly working?: string;

  /** Why the list could not be read the last time it was, where it could not. */
  readonly problem?: string;
}

/** The projects kept, and the changes to the list. */
export class ProjectLibraryStore implements Observable<LibraryState> {
  private readonly library: LibraryClient;
  private readonly lifetime: AbortSignal;
  private readonly readings: Requests;
  private readonly state = observable<LibraryState>({ entries: [], loaded: false });

  readonly get = this.state.get;
  readonly subscribe = this.state.subscribe;

  /** The list kept by `library`, whose work ends once `lifetime` aborts. */
  constructor(library: LibraryClient, lifetime: AbortSignal) {
    this.library = library;
    this.lifetime = lifetime;
    this.readings = new Requests(() => lifetime);
  }

  /**
   * Reads the list again from the catalogue. A reading replaced by a newer one
   * is given up and settles at once, leaving the list to the newer one.
   */
  readonly refresh = async (): Promise<DomainResult<void>> => {
    const signal = this.readings.next();
    let entries: readonly CatalogueEntry[];
    try {
      entries = await this.library.list(signal);
    } catch (error) {
      if (signal.aborted && isAbandoned(error)) return succeed(undefined);
      // The storage refusing to be listed, as a full or unreachable one does,
      // is said in the list; anything else is a fault, and surfaces as one.
      if (!(error instanceof TreeFailure)) throw error;
      const problem = `The list of projects could not be read: ${error.message}`;
      this.state.update((current) => ({ ...current, problem }));
      return fail(failure('storage.list-refused', FailureKind.Retryable, problem));
    }
    this.state.update(({ problem: _read, ...current }) => ({ ...current, entries, loaded: true }));
    return succeed(undefined);
  };

  readonly create = (project: NewProject): Promise<DomainResult<ProjectHeader>> =>
    this.changing(`Making ${quoted(project.name.trim())}`, () =>
      this.library.create(project, this.lifetime),
    );

  readonly remove = (project: ProjectId): Promise<DomainResult<ProjectHeader>> =>
    this.changing('Deleting a project', () => this.library.softDelete(project));

  readonly restore = (project: ProjectId): Promise<DomainResult<ProjectHeader>> =>
    this.changing('Restoring a project', () => this.library.restore(project));

  readonly purge = (project: ProjectId, deletedAt: number): Promise<DomainResult<void>> =>
    this.changing('Purging a project', () => this.library.purge(project, { deletedAt }));

  readonly fork = (request: ForkRequest): Promise<DomainResult<ProjectHeader>> =>
    this.changing(`Making ${quoted(request.name.trim())}`, () =>
      this.library.fork(request, this.lifetime),
    );

  /** The header of a project the list holds, as last read. */
  readonly headerOf = (project: ProjectId): ProjectHeader | undefined => {
    for (const entry of this.state.get().entries) {
      if (entry.kind === 'project' && entry.header.id === project) return entry.header;
    }
    return undefined;
  };

  /** Runs a change, saying what it is while it runs, and reads the list again after. */
  private async changing<TValue>(
    working: string,
    change: () => Promise<DomainResult<TValue>>,
  ): Promise<DomainResult<TValue>> {
    this.state.update((current) => ({ ...current, working }));
    try {
      return await change();
    } finally {
      await this.refresh();
      this.state.update(({ working: _done, ...rest }) => rest);
    }
  }
}
