/**
 * The library of projects, served to the page: listing every project, making,
 * deleting, restoring and purging one, and forking one (REQ-STOR-026,
 * REQ-STOR-102, REQ-STOR-199).
 *
 * The list is answered whole, as the catalogue lists it, rather than an entry
 * at a time: the page reads all of it each time, a header is small, and a
 * call answered once is all the port has. A listing abandoned stops at the
 * next project.
 */

import { forkProject, type CatalogueEntry } from '@audiogubbins/storage';

import type { AreaHandlers } from '../protocol/storage-operations.js';
import type { HostServices } from './host-services.js';

/** The library's operations, over the worker's services. */
export function libraryHandlers(services: HostServices): AreaHandlers<'library'> {
  const { repository } = services;
  return {
    'library.list': async (_nothing, { signal }) => {
      const entries: CatalogueEntry[] = [];
      for await (const entry of repository.list(signal)) entries.push(entry);
      return entries;
    },
    'library.create': (project, { signal }) => repository.create(project, signal),
    'library.softDelete': (project) => repository.softDelete(project),
    'library.restore': (project) => repository.restore(project),
    'library.purge': ({ project, confirmation }) => repository.purgeProject(project, confirmation),
    'library.fork': (request, { signal }) => forkProject(request, services, signal),
  };
}
