/**
 * Gathering every piece of managed media the projects retain, which a purge of
 * media must not remove (REQ-STOR-099, REQ-STOR-102, REQ-STOR-193).
 *
 * Media is retained by far more than the state a project is in: by every state
 * it keeps whole, by every change its history can undo or redo, whose
 * invocations name the media they add or remove, and by every record not yet
 * folded into a checkpoint, the quarantined among them. A deleted project
 * retains its media until it is purged. So every project's states are read by
 * the media store's own rule, `contentReferencedBy`, and every checkpoint and
 * journal record is searched for any content identifier it holds anywhere,
 * which errs, as it must, on the side of keeping.
 *
 * A file that cannot be read cannot say what it retains, so it is reported to
 * the caller, which must not purge as though it retained nothing. The roots are
 * yielded as they are found, so the caller marks them without holding a list of
 * every file.
 */

import {
  flatMapResult,
  isWellFormedId,
  unsafeBrandId,
  type DomainFailure,
} from '@audiogubbins/domain';
import { contentReferencedBy, type ContentRoots } from '@audiogubbins/media-store';
import {
  contentIdFrom,
  decodeUtf8,
  isContentId,
  isJsonArray,
  isJsonObject,
  parseJson,
  type ContentId,
  type Digest,
  type JsonValue,
  type StorageTree,
} from '@audiogubbins/project-format';

import { CheckedRecords } from './checked-records.js';
import { ProjectFiles } from './project-files.js';
import { PROJECTS_DIRECTORY } from './storage-layout.js';

/** A file whose retained media could not be told, and why. */
export interface UnreadableRoot {
  readonly path: string;
  readonly failure: DomainFailure;
}

/** The bounds a checkpoint's or record's text is searched within. */
const SEARCH_LIMITS = { maximumLength: 2 ** 28, maximumDepth: 32 } as const;

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
  return gather(new CheckedRecords(tree, digest), onUnreadable, signal);
}

async function* gather(
  records: CheckedRecords,
  onUnreadable: (root: UnreadableRoot) => void,
  signal?: AbortSignal,
): AsyncGenerator<ContentId, void, undefined> {
  for (const entry of await records.tree.list(PROJECTS_DIRECTORY)) {
    if (entry.kind !== 'directory' || !isWellFormedId(entry.name)) continue;
    const files = new ProjectFiles(records, unsafeBrandId<'ProjectId'>(entry.name));
    for (const fingerprint of await files.states.list()) {
      signal?.throwIfAborted();
      const state = await files.states.get(fingerprint, signal);
      if (state.ok) yield* contentReferencedBy(state.value);
      else onUnreadable({ path: files.paths.state(fingerprint), failure: state.failures[0] });
    }
    for (const directory of [files.paths.checkpoints, files.paths.journal]) {
      for await (const path of filesUnder(records.tree, directory)) {
        signal?.throwIfAborted();
        yield* searched(await records.tree.readFile(path, signal), path, onUnreadable);
      }
    }
  }
}

/** Every file under a directory, in name order. */
async function* filesUnder(tree: StorageTree, directory: string): AsyncGenerator<string> {
  for (const entry of await tree.list(directory)) {
    const path = `${directory}/${entry.name}`;
    if (entry.kind === 'directory') yield* filesUnder(tree, path);
    else yield path;
  }
}

/** Every content identifier a JSON file holds, anywhere in it. */
function* searched(
  bytes: Uint8Array | undefined,
  path: string,
  onUnreadable: (root: UnreadableRoot) => void,
): Generator<ContentId> {
  if (bytes === undefined) return;
  const parsed = flatMapResult(decodeUtf8(bytes), (text) => parseJson(text, SEARCH_LIMITS));
  if (!parsed.ok) {
    onUnreadable({ path, failure: parsed.failures[0] });
    return;
  }
  const pending: JsonValue[] = [parsed.value];
  for (let value = pending.pop(); value !== undefined; value = pending.pop()) {
    if (typeof value === 'string') {
      // Tested first, so the text of a project is not a refusal built per string.
      const content = isContentId(value) ? contentIdFrom(value) : undefined;
      if (content?.ok === true) yield content.value;
    } else if (isJsonArray(value)) {
      pending.push(...value);
    } else if (isJsonObject(value)) {
      pending.push(...Object.values(value));
    }
  }
}
