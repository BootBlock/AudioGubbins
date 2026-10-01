/**
 * What a storage API's error means for whoever asked, by the error's name.
 *
 * The browser reports every refusal as a `DOMException`, and its name is the
 * only part the specifications fix. One home for the reading, so the worker,
 * the sinks over the user's own files and the kept handles decide alike
 * (REQ-EXEC-136.11), and every refusal becomes a designed failure
 * (REQ-EXEC-136.15): a full disk may take the bytes once room is made
 * (REQ-STOR-106), storage that cannot be reached will not, and anything else
 * the platform gives may pass.
 */

import { TreeFailure, TreeFailureKind } from '@audiogubbins/project-format';

/**
 * The names that mean the storage cannot be reached at all.
 *
 * `SecurityError` is a private window or blocked site data refusing the
 * storage; `InvalidStateError` a handle or database the browser has closed
 * under the page; `NotAllowedError` a permission the user withdrew; and
 * `NotSupportedError` a browser without the API, which the worker reports where
 * it has no origin-private file system.
 */
const UNREACHABLE: ReadonlySet<string> = new Set([
  'SecurityError',
  'InvalidStateError',
  'NotAllowedError',
  'NotSupportedError',
]);

/**
 * The names that mean nothing is there: no entry of that name, or one of the
 * other kind, a directory where a file was asked for or the reverse.
 */
const NOTHING_THERE: ReadonlySet<string> = new Set(['NotFoundError', 'TypeMismatchError']);

/** What a refusal the platform gave means, by the name of its error. */
function failureKindOf(error: DOMException): TreeFailureKind {
  if (error.name === 'QuotaExceededError') return TreeFailureKind.Quota;
  if (UNREACHABLE.has(error.name)) return TreeFailureKind.Unavailable;
  return TreeFailureKind.Io;
}

/** Whether a refusal says only that nothing of the kind asked for is there. */
export function meansAbsent(error: unknown): boolean {
  return error instanceof DOMException && NOTHING_THERE.has(error.name);
}

/** The designed failure a refusal the platform gave becomes, keeping it as the cause. */
export function treeFailureOf(error: DOMException): TreeFailure {
  return new TreeFailure(failureKindOf(error), error.message, { cause: error });
}
