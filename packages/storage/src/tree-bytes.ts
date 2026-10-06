/**
 * The bytes a directory of the storage tree holds, as usage, a cleanup's plan
 * and its run each count them: every file's size, read from the file as the
 * tree hands it out and never from its bytes, so measuring a model pack or a
 * backup reads none of it (REQ-STOR-200).
 */

import type { StorageTree } from '@audiogubbins/project-format';

/** The bytes of every file under a directory. */
export async function bytesUnder(
  tree: StorageTree,
  directory: string,
  signal?: AbortSignal,
): Promise<number> {
  let bytes = 0;
  for (const entry of await tree.list(directory)) {
    signal?.throwIfAborted();
    const path = `${directory}/${entry.name}`;
    bytes +=
      entry.kind === 'directory'
        ? await bytesUnder(tree, path, signal)
        : ((await tree.openFile(path))?.size ?? 0);
  }
  return bytes;
}
