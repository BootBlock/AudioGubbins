/**
 * What a crash leaves of a project's making or of its purge, and finishing it
 * (REQ-STOR-102, REQ-STOR-101).
 *
 * A project is made with a marker saying it is unfinished, removed once its
 * header is written (`project-creation.ts`), so a directory with the marker and
 * no header that can be read was never finished, and nothing refers to it. A
 * purge marks the header before it removes anything, then removes the project's
 * backups and its files, its header last, so a project whose header is marked
 * was confirmed for purging and is part gone. Neither is ever finished by what
 * began it, so cleanup, a purge of the same project and an import of its
 * identity each finish what they find.
 */

import type { StorageTree } from '@audiogubbins/project-format';

import { readPair } from './generational-pair.js';
import type { ProjectFiles } from './project-files.js';
import { BackupPaths } from './storage-layout.js';

/** What a crash left of a project: its making, or its purge, cut short. */
export type LeftOver = 'unfinished' | 'purging';

/** What a crash left of a project, or `undefined` where it is whole or not there at all. */
export async function leftOverOf(
  files: ProjectFiles,
  signal?: AbortSignal,
): Promise<LeftOver | undefined> {
  const newest = (await readPair(files.records, files.header, signal)).valid[0];
  if (newest !== undefined) return newest.value.purging === undefined ? undefined : 'purging';
  return (await files.isUnfinished()) ? 'unfinished' : undefined;
}

/** Removes what a crash left of a project. */
export async function removeLeftOver(files: ProjectFiles, leftOver: LeftOver): Promise<void> {
  if (leftOver === 'purging') await removePurged(files);
  else await files.records.tree.remove(files.paths.directory);
}

/**
 * Removes a project whose header is marked as being purged: its backups, then
 * its files, its header last, so a crash on the way leaves it marked.
 */
export async function removePurged(files: ProjectFiles): Promise<void> {
  const tree: StorageTree = files.records.tree;
  const { paths } = files;
  await tree.remove(new BackupPaths(files.project).directory);
  const headers = new Set([paths.header(0), paths.header(1)]);
  for (const entry of await tree.list(paths.directory)) {
    const path = `${paths.directory}/${entry.name}`;
    if (!headers.has(path)) await tree.remove(path);
  }
  await tree.remove(paths.directory);
}
