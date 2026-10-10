/**
 * Where the storage stages work in progress (ADR-0090, ADR-0092): the cache
 * category `staging`, scoped by the project the work is for.
 *
 * - `cache/staging/<project>/rendition-<token>`: the data of a rendition being
 *   decoded, removed once it is stored or abandoned.
 * - `cache/staging/<project>/export-<token>.head`, `.body` and `.tail`: an
 *   export staged for delivery, its body written as it is encoded and its head
 *   and tail once the encoder finishes, removed once it is delivered.
 *
 * Nothing here is a root: storage pressure gives it up after temporary data,
 * and the whole staging is removed whenever the storage worker starts alone,
 * since what a window left there is work it can no longer finish.
 */

import type { ProjectId } from '@audiogubbins/domain';
import type { StorageTree } from '@audiogubbins/project-format';

import { CacheCategory } from './cache-store.js';
import { CACHE_DIRECTORY } from './storage-layout.js';
import { whileAlone, type Alone } from './storage-sharing.js';
import type { LeaseCoordinator } from './write-lease.js';

/** The directory the storage stages its work in. */
export const STAGING_DIRECTORY = `${CACHE_DIRECTORY}/${CacheCategory.Staging}`;

/** The scratch file a rendition of `project` is decoded into, named by `token`. */
export function renditionScratchPath(project: ProjectId, token: string): string {
  return `${STAGING_DIRECTORY}/${project}/rendition-${token}`;
}

/** The files an export of `project` is staged in, named by `token`. */
export interface StagedExportPaths {
  readonly head: string;
  readonly body: string;
  readonly tail: string;
}

/** The files an export of `project` is staged in, named by `token`. */
export function stagedExportPaths(project: ProjectId, token: string): StagedExportPaths {
  const base = `${STAGING_DIRECTORY}/${project}/export-${token}`;
  return { head: `${base}.head`, body: `${base}.body`, tail: `${base}.tail` };
}

/**
 * Removes everything staged, as the storage worker does when it starts, with
 * the storage-wide lock held alone, so no window's work in progress is taken:
 * where another window shares the lock, or windows cannot be told apart,
 * nothing is removed this time.
 */
export async function clearStaging(
  tree: StorageTree,
  coordinator: LeaseCoordinator | undefined,
): Promise<Alone<void>> {
  return await whileAlone(coordinator, async () => {
    await tree.remove(STAGING_DIRECTORY);
  });
}
