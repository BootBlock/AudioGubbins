/**
 * How the bytes of a tree's media and caches are read (REQ-STOR-099,
 * REQ-STOR-103, REQ-EXEC-216).
 *
 * A tree names the bytes of each of its bodies: media by its name, a cache in
 * the tree's index of caches. Bodies read out of the storage are proved
 * against those names as they are read (`proved-bytes.ts`), so whatever copies
 * them out streams them as they come. Bodies read from a bundle or a directory
 * come unproved, since what keeps them hashes them as it writes them, the
 * media store under their name and the cache store against the index; a copy
 * of them anywhere else proves them as it streams them ({@link provedBodies}).
 * So every body is read and hashed once, by whatever takes it, and none is
 * kept or written on without being the bytes its tree names.
 */

import type { DomainResult } from '@audiogubbins/domain';
import type { ByteSource, Digest, ProjectTreeFile } from '@audiogubbins/project-format';

import { cacheNotListed } from './cache-store.js';
import { provedBytes } from './proved-bytes.js';
import { mediaDamaged } from './storage-failures.js';

/** How the bytes of a media file or a cache of a tree are read, proved as they are read. */
export type BodyOpener = (
  file: ProjectTreeFile,
  signal?: AbortSignal,
) => Promise<DomainResult<ByteSource>>;

/** Bytes of a body not yet proved: whoever reads them proves them. */
export interface UnprovedBody {
  readonly unproved: ByteSource;
}

/** How the bytes of a media file or a cache of a tree are read, unproved. */
export type UnprovedBodies = (
  file: ProjectTreeFile,
  signal?: AbortSignal,
) => Promise<DomainResult<UnprovedBody>>;

/** The bodies `open` reads, each proved against what its tree names as it is read. */
export function provedBodies(open: UnprovedBodies, digest: Digest): BodyOpener {
  return async (file, signal) => {
    const { path, body } = file;
    if (body.kind === 'text') throw new Error(`A tree's text is never opened: ${path}`);
    const opened = await open(file, signal);
    if (!opened.ok) return opened;
    const refusal =
      body.kind === 'media' ? mediaDamaged(path, body.contentId) : cacheNotListed(body.path);
    return await provedBytes(opened.value.unproved, body.contentId, digest, refusal);
  };
}
