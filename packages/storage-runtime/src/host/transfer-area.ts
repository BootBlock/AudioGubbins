/**
 * Taking projects out and bringing them in, served to the page, through the
 * ports it lent for each call, and copying a project's linked files into it
 * (REQ-STOR-099, REQ-STOR-103, REQ-STOR-166).
 *
 * An export of the project the page has open to write waits, as the storage's
 * own does, for the session its handle names to have written every change. A
 * linked file is copied through that session too, one project command each,
 * which the worker builds itself, since the invocation is pure; the search
 * that finds each file stays on the page, where the browser asks the person
 * for leave to read it. Every one takes the call's signal and the worker's
 * turns, so a cancel stops it where it next looks.
 */

import { setAssetMediaInvocation } from '@audiogubbins/project-commands';
import {
  consolidate,
  exportBackup,
  exportBundle,
  exportUnpacked,
  importBundle,
  importUnpacked,
  type ExportFrom,
} from '@audiogubbins/storage';

import type { ProjectHandle } from '../protocol/project-operations.js';
import type { AreaHandlers, HostChannel } from '../protocol/storage-operations.js';
import type { HostServices } from './host-services.js';
import type { OpenProjects } from './open-projects.js';
import { pageBytes, pageFolder, pageLocate, pageSink, pageWriter } from './remote-page-ports.js';

/** The transfer operations, over the worker's services, its open projects and the page's ports. */
export function transferHandlers(
  services: HostServices,
  projects: OpenProjects,
  channel: HostChannel,
): AreaHandlers<'transfers'> {
  const from = (held: ProjectHandle | undefined): ExportFrom =>
    held === undefined ? {} : { held: projects.session(held) };
  return {
    'transfers.exportBundle': ({ project, sink, options, held }, { signal }) =>
      exportBundle(
        project,
        pageSink(channel, sink),
        { ...options, ...from(held) },
        services,
        signal,
      ),
    'transfers.exportBackup': ({ project, generation, sink, options }, { signal }) =>
      exportBackup(project, generation, pageSink(channel, sink), options, services, signal),
    'transfers.exportUnpacked': ({ project, folder, options, held }, { signal }) =>
      exportUnpacked(
        project,
        pageWriter(channel, folder),
        { ...options, ...from(held) },
        services,
        signal,
      ),
    'transfers.importBundle': ({ bundle, identity }, { signal }) =>
      importBundle(pageBytes(channel, bundle), identity, services, signal),
    'transfers.importUnpacked': ({ folder, identity }, { signal }) =>
      importUnpacked(pageFolder(channel, folder), identity, services, signal),
    'transfers.consolidate': ({ handle, locate }, { signal }) =>
      consolidate(
        projects.session(handle),
        {
          store: services.store,
          digest: services.digest,
          yieldToHost: services.yieldToHost,
          locate: pageLocate(channel, locate),
          setMedia: setAssetMediaInvocation,
        },
        signal,
      ),
  };
}
