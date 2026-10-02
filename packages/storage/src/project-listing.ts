/**
 * The projects a directory of the storage holds, by the identifiers their
 * directories are named with: the kept projects, or those with backups
 * (ADR-0020).
 */

import { isWellFormedId, unsafeBrandId, type ProjectId } from '@audiogubbins/domain';
import type { StorageTree } from '@audiogubbins/project-format';

/** Every project directory under `directory`, by identifier. */
export async function projectsIn(
  tree: StorageTree,
  directory: string,
): Promise<readonly ProjectId[]> {
  return (await tree.list(directory)).flatMap((entry) =>
    entry.kind === 'directory' && isWellFormedId(entry.name)
      ? [unsafeBrandId<'ProjectId'>(entry.name)]
      : [],
  );
}
