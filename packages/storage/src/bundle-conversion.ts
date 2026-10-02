/**
 * Converting between a portable bundle and an unpacked tree without the
 * storage: a bundle unpacked into a directory, and a directory's tree packed
 * into a bundle (REQ-STOR-103).
 *
 * The bundle is exactly the tree and its manifest, and both directions read the
 * whole project and check it before writing it, then write it as the format
 * writes a project, so a bundle unpacked and packed again is the bundle it was,
 * byte for byte, and nothing of the project is lost either way. A directory's
 * media is hashed as it is packed and must be the media its name says; a
 * bundle's is checked against its manifest as it is unpacked.
 */

import type { DomainResult } from '@audiogubbins/domain';
import {
  projectTree,
  readProjectTree,
  type ByteSink,
  type ByteSource,
  type ZipWritten,
} from '@audiogubbins/project-format';

import { openBundle, type BundleServices } from './bundle-reading.js';
import { writeBundle } from './bundle-writing.js';
import {
  claimDirectory,
  directoryTree,
  writeTreeInto,
  type DirectoryClaim,
  type DirectoryReader,
  type DirectoryWriter,
} from './project-directory.js';

/**
 * Writes the tree a bundle holds into a directory, claimed for its project
 * first as `claim` allows.
 */
export async function unpackBundle(
  source: ByteSource,
  writer: DirectoryWriter,
  services: BundleServices,
  claim: DirectoryClaim = {},
  signal?: AbortSignal,
): Promise<DomainResult<void>> {
  const bundle = await openBundle(source, services, signal);
  if (!bundle.ok) return bundle;
  const content = await readProjectTree(bundle.value.listing, services.digest, signal);
  if (!content.ok) return content;
  const claimed = await claimDirectory(writer, content.value.state.project.id, claim, signal);
  if (!claimed.ok) return claimed;
  const tree = projectTree(content.value);
  if (!tree.ok) return tree;
  return (await writeTreeInto(claimed.value, tree.value, bundle.value.open, signal)).written;
}

/** Writes the tree a directory holds as a bundle into `sink`, and closes it. */
export async function packUnpacked(
  reader: DirectoryReader,
  sink: ByteSink,
  services: BundleServices,
  signal?: AbortSignal,
): Promise<DomainResult<ZipWritten>> {
  const { digest, yieldToHost } = services;
  const tree = await directoryTree(reader, signal);
  if (!tree.ok) {
    await sink.abort(tree.failures[0]);
    return tree;
  }
  const content = await readProjectTree(tree.value.listing, digest, signal);
  if (!content.ok) {
    await sink.abort(content.failures[0]);
    return content;
  }
  const files = projectTree(content.value);
  if (!files.ok) {
    await sink.abort(files.failures[0]);
    return files;
  }
  return await writeBundle(files.value, sink, {
    open: tree.value.open,
    digest,
    proveMedia: true,
    yieldToHost,
    ...(signal === undefined ? {} : { signal }),
  });
}
