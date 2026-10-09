/**
 * What project storage works with on this page, made once by the composition
 * root from what the browser offers (ADR-0022, ADR-0020, REQ-STOR-021,
 * REQ-STOR-098, REQ-EXEC-216).
 *
 * The storage core runs in one dedicated worker, which the page starts here and
 * talks to through the storage client, so the page keeps no project, history,
 * tree or store of its own: every store and command is given the client rather
 * than reaching for the worker (ADR-0011). What only the page can do stays
 * here: the handles of linked files and of the backups folder are kept by the
 * page, which alone can ask the person for leave to read or write through them,
 * and the digest names the caches the editor keeps. Where the browser cannot
 * keep projects at all, which needs the private file system, the digest and
 * random numbers, the answer says so, and the Capabilities panel says why;
 * where it lacks only Web Locks, projects open read-only, as the storage
 * decides in the worker (REQ-STOR-098).
 */

import { FileHandleKeeper, randomTokens, webDigest } from '@audiogubbins/browser-storage';
import type { StoragePlatform } from '@audiogubbins/capabilities';
import type { DiagnosticCentre, Logger } from '@audiogubbins/diagnostics';
import type { Digest } from '@audiogubbins/project-format';
import { connectStorage, type StorageClient } from '@audiogubbins/storage-runtime';
import storageWorkerUrl from '@audiogubbins/storage-runtime/threads/storage-worker.ts?worker&url';

import { moduleWorkerClass } from '../module-worker.js';

/** What the project stores and the page's own ports work with. */
export interface ProjectServices {
  /** The storage worker, as the page asks it for everything storage does. */
  readonly client: StorageClient;

  /** Where the page keeps the handles of linked files, absent where the browser keeps none. */
  readonly keeper: FileHandleKeeper | undefined;

  /** The browser's SHA-256, which names the caches the editor keeps. */
  readonly digest: Digest;
  readonly logger: Logger;
}

/** Whether this browser can keep projects, and what it keeps them with. */
export type ProjectPlatform =
  | { readonly kind: 'available'; readonly services: ProjectServices }
  | { readonly kind: 'unavailable'; readonly reason: string };

/** Why no project can be kept here, pointing at the panel that says which part is missing. */
const CANNOT_KEEP_PROJECTS =
  'This browser cannot keep projects, so none can be made or opened here. The Capabilities panel says why.';

/** Starts the storage worker, which Vite builds as a module of its own, under the page's policy. */
function storageWorker(): Worker {
  return new (moduleWorkerClass())(storageWorkerUrl, 'AudioGubbins storage');
}

/**
 * Starts the storage worker and makes what the page keeps projects with, or
 * says why this browser cannot keep projects.
 */
export function projectPlatformOf(
  platform: StoragePlatform,
  diagnostics: DiagnosticCentre,
): ProjectPlatform {
  const { subtle, randomBytes } = platform;
  if (!platform.originPrivateFileSystem || subtle === undefined || randomBytes === undefined) {
    return { kind: 'unavailable', reason: CANNOT_KEEP_PROJECTS };
  }
  const services: ProjectServices = {
    client: connectStorage(storageWorker(), diagnostics),
    keeper:
      platform.indexedDb === undefined
        ? undefined
        : new FileHandleKeeper(platform.indexedDb, randomTokens(randomBytes)),
    digest: webDigest(subtle),
    logger: diagnostics.loggerFor('projects'),
  };
  return { kind: 'available', services };
}
