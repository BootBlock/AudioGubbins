/**
 * The files linked assets were recorded from, served to the page: looking at
 * one again to say whether it is the file the project recorded, and taking a
 * file as an asset's new version or its new link (REQ-STOR-104,
 * REQ-STOR-053).
 *
 * The page finds the file, since the browser asks the person for leave to read
 * it there, and passes it; the worker reads it, samples it and, where the
 * recorded identity knows the content, hashes it whole, with the worker's
 * digest and its turns, so the page spends nothing on a long file.
 */

import { examineFile } from '@audiogubbins/media-store';
import {
  adoptSourceVersionInvocation,
  relinkSourceInvocation,
} from '@audiogubbins/project-commands';
import { takeSourceVersion } from '@audiogubbins/storage';

import type { AreaHandlers, HostChannel } from '../protocol/storage-operations.js';
import type { HostServices } from './host-services.js';
import type { OpenProjects } from './open-projects.js';
import { pageFile } from './remote-page-ports.js';

/** The commands each way of taking a file runs, which the worker builds, being pure. */
const INVOCATIONS = { relink: relinkSourceInvocation, adopt: adoptSourceVersionInvocation };

/**
 * The operations of linked files, over the worker's digest and store, its
 * open projects and the files the page passes.
 */
export function sourceHandlers(
  services: HostServices,
  projects: OpenProjects,
  channel: HostChannel,
): AreaHandlers<'sources'> {
  return {
    'sources.examine': ({ recorded, file }, { signal }) =>
      examineFile(recorded, pageFile(channel, file), services, signal),
    'sources.takeVersion': ({ handle, asset, change, identity, file }, { signal }) =>
      takeSourceVersion(
        projects.session(handle),
        { asset, change, identity, file: pageFile(channel, file) },
        { store: services.store, digest: services.digest, invocation: INVOCATIONS },
        signal,
      ),
  };
}
