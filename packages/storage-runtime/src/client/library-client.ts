/**
 * The library of projects, as the page asks the storage worker for it: every
 * project listed, and the changes to the list (REQ-STOR-026, REQ-STOR-102,
 * REQ-STOR-199).
 */

import type { DomainResult, ProjectId } from '@audiogubbins/domain';
import type {
  CatalogueEntry,
  ForkRequest,
  NewProject,
  ProjectHeader,
  PurgeProjectConfirmation,
} from '@audiogubbins/storage';

import type { ClientChannel } from '../protocol/storage-operations.js';

/** The projects the storage holds, and the changes to them. */
export interface LibraryClient {
  /**
   * Every project, deleted ones among them, in the order of their identifiers,
   * and an entry for anything whose header cannot be read. Rejects with a
   * `TreeFailure` where the storage refuses to be listed.
   */
  list(signal?: AbortSignal): Promise<readonly CatalogueEntry[]>;

  /** Makes a new, empty project and gives its header. */
  create(project: NewProject, signal?: AbortSignal): Promise<DomainResult<ProjectHeader>>;

  /** Deletes a project softly: it is hidden, and everything it holds is kept. */
  softDelete(project: ProjectId): Promise<DomainResult<ProjectHeader>>;
  restore(project: ProjectId): Promise<DomainResult<ProjectHeader>>;

  /** Removes a deleted project for good, once the person confirmed the deletion they were shown. */
  purge(project: ProjectId, confirmation: PurgeProjectConfirmation): Promise<DomainResult<void>>;

  /** Makes a fork of a project, from a node of its history or a named snapshot. */
  fork(request: ForkRequest, signal?: AbortSignal): Promise<DomainResult<ProjectHeader>>;
}

/** The library, over the page's end of the port. */
export function libraryClient(channel: ClientChannel): LibraryClient {
  return {
    list: (signal) => channel.call('library.list', undefined, { signal }),
    create: (project, signal) => channel.call('library.create', project, { signal }),
    softDelete: (project) => channel.call('library.softDelete', project),
    restore: (project) => channel.call('library.restore', project),
    purge: (project, confirmation) => channel.call('library.purge', { project, confirmation }),
    fork: (request, signal) => channel.call('library.fork', request, { signal }),
  };
}
