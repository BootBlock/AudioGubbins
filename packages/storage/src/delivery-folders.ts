/**
 * The folder a delivery writes into, inside the folder the person chose or
 * keeps trusted (ADR-0102): a relative path of folder names, outermost first,
 * walked down before anything is decided or written.
 *
 * The path crosses from the page, so it is held here to the rule a game
 * export's destination is planned by (`folderSegmentProblem`): each name one
 * `safeFolderName` leaves as it is, and neither `.` nor `..`. That refuses an
 * empty name, a separator or a drive's colon inside a name, and every step out,
 * so nothing is written outside the folder chosen. A folder the path names that
 * is not there yet is made only once a file is created in it
 * (`DeliveryFolder.folder`), so a delivery refused, skipped or cancelled leaves
 * the destination as it was.
 */

import type { DomainFailure } from '@audiogubbins/domain';
import { folderSegmentProblem } from '@audiogubbins/import-export';

import { deliveryPathInvalid, destinationFolderTaken } from './export-failures.js';

/** A folder a path is walked down: each folder inside it, by name. */
interface WalkedFolder<Folder> {
  folder(name: string, signal?: AbortSignal): Promise<Folder | undefined>;
}

/** The folder a path leads to, or why the delivery writes nothing. */
type ReachedFolder<Folder> =
  | { readonly kind: 'reached'; readonly folder: Folder }
  | { readonly kind: 'refused'; readonly failure: DomainFailure };

/** Why `path` is not a path of folders inside the one it starts from, where it is not. */
function deliveryPathProblem(path: readonly string[]): DomainFailure | undefined {
  for (const [index, segment] of path.entries()) {
    if (folderSegmentProblem(segment) !== undefined) return deliveryPathInvalid(segment, index);
  }
  return undefined;
}

/**
 * The folder `path` leads to from `root`, each folder not there yet one to be
 * made; refused where the path is not one inside `root`, or where one of its
 * names is a file's.
 */
export async function folderReached<Folder extends WalkedFolder<Folder>>(
  root: Folder,
  path: readonly string[],
  signal?: AbortSignal,
): Promise<ReachedFolder<Folder>> {
  const problem = deliveryPathProblem(path);
  if (problem !== undefined) return { kind: 'refused', failure: problem };
  let folder = root;
  for (const [index, name] of path.entries()) {
    signal?.throwIfAborted();
    const inner = await folder.folder(name, signal);
    if (inner === undefined) {
      return {
        kind: 'refused',
        failure: destinationFolderTaken(path.slice(0, index + 1).join('/')),
      };
    }
    folder = inner;
  }
  return { kind: 'reached', folder };
}
