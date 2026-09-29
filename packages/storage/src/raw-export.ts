/**
 * Exporting the storage as it is, every file of it, into one ZIP archive: the
 * backup the person may take before wiping storage of a schema this build
 * cannot read (REQ-STOR-052).
 *
 * The files are copied as bytes and never read as records, since they may be of
 * any schema. Each is streamed from the tree into the archive a chunk at a
 * time, so a media object larger than memory is exported like any other file
 * (REQ-EXEC-216). Nothing in the storage is changed.
 */

import type { DomainResult } from '@audiogubbins/domain';
import {
  writeZip,
  type ByteSink,
  type StorageTree,
  type ZipEntryInput,
  type ZipWritingOptions,
  type ZipWritten,
} from '@audiogubbins/project-format';

import { refusalsReported } from './storage-failures.js';

/** Writes every file of the tree into a ZIP archive in `sink`, and closes it. */
export async function exportRawStorage(
  tree: StorageTree,
  sink: ByteSink,
  options: ZipWritingOptions = {},
): Promise<DomainResult<ZipWritten>> {
  return await refusalsReported(async () => await writeZip(filesOf(tree, ''), sink, options));
}

/**
 * Every file under a directory, in name order, each opened only as the archive
 * comes to it. A file removed between listing and opening is passed over.
 */
async function* filesOf(tree: StorageTree, directory: string): AsyncGenerator<ZipEntryInput> {
  for (const entry of await tree.list(directory)) {
    const path = directory === '' ? entry.name : `${directory}/${entry.name}`;
    if (entry.kind === 'directory') {
      yield* filesOf(tree, path);
      continue;
    }
    const source = await tree.openFile(path);
    if (source !== undefined) yield { path, source };
  }
}
