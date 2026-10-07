/**
 * Gathering every piece of managed media the projects retain, which a purge of
 * media must not remove (REQ-STOR-099, REQ-STOR-102, REQ-STOR-193).
 *
 * Media is retained by whatever a restore or an undo could bring back, which
 * `project-roots.ts` walks: a state names its media by the media store's own
 * rule, `contentReferencedBy`, and the rest is searched for any content
 * identifier it holds anywhere, which errs, as it must, on the side of
 * keeping. A file that cannot be read cannot say what it retains, so it is
 * reported to the caller, which must not purge as though it retained nothing.
 */

import { contentReferencedBy, type ContentRoots } from '@audiogubbins/media-store';
import type { Digest, StorageTree } from '@audiogubbins/project-format';

import { CheckedRecords } from './checked-records.js';
import { contentIdsIn } from './content-references.js';
import { projectRoots, type UnreadableRoot } from './project-roots.js';

/** What media a state and a record's value name. */
const MEDIA = { inState: contentReferencedBy, inValue: contentIdsIn } as const;

/**
 * Every content identifier every project retains, each project's in turn; an
 * identifier may be yielded more than once. `onUnreadable` hears of each file
 * that could not be read.
 */
export function retainedMedia(
  tree: StorageTree,
  digest: Digest,
  onUnreadable: (root: UnreadableRoot) => void,
  signal?: AbortSignal,
): ContentRoots {
  return projectRoots(new CheckedRecords(tree, digest), MEDIA, onUnreadable, signal);
}
