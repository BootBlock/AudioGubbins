/**
 * Why a backup was not made, or not copied to the backups folder, in the words
 * the status bar, the Backups settings and the command that backs up now say,
 * so each tells the person the same (REQ-STOR-105, REQ-STOR-021).
 *
 * The storage's own sentence for a refused write is about a change kept in
 * memory until it is saved, which is the save status's to say: a backup is not
 * kept anywhere until it is written, so each reason is worded here for the
 * backup, with what the person can do about it. A reason the storage gives that
 * is not a refused write is already about what it refused, and is said as it
 * stands.
 */

import type { DomainFailure } from '@audiogubbins/domain';
import { storageRefusalOf, unreadableStateOf, type StorageRefusal } from '@audiogubbins/storage';
import { quoted } from '@audiogubbins/text';

/** Why the storage did not take a backup, by why it refused the write. */
const NOT_MADE: Readonly<Record<StorageRefusal, string>> = {
  full: "This site's storage is full. Delete what you no longer need in the Storage panel, then back up again.",
  unavailable:
    'The storage could not be reached. AudioGubbins tries again at the next backup, or back up now.',
  failed:
    'The storage refused to write it for a reason of its own. AudioGubbins tries again at the next backup, or back up now.',
};

/** Why the backups folder did not take a copy, by why it refused the write. */
const NOT_COPIED: Readonly<Record<StorageRefusal, string>> = {
  full: 'The drive the backups folder is on is full. Make room there, then back up again.',
  unavailable:
    'The folder cannot be written now: leave to write to it has not been given since the page loaded, or it is no longer there.',
  failed: 'The folder refused the copy for a reason of its own. Back up again to try once more.',
};

/** Why a backup was not made, in a sentence or two. */
export function notMadeReason(cause: DomainFailure): string {
  const refusal = storageRefusalOf(cause);
  if (refusal !== undefined) return NOT_MADE[refusal];
  const unreadable = unreadableStateOf(cause);
  if (unreadable === undefined) return cause.summary;
  const { snapshot } = unreadable;
  return snapshot === undefined
    ? "A state the project's history keeps cannot be read, so a backup would lack it."
    : `The state the snapshot ${quoted(snapshot)} keeps cannot be read, so a backup would lack it.`;
}

/** Why a backup made was not copied to the backups folder, in a sentence or two. */
export function notCopiedReason(cause: DomainFailure): string {
  const refusal = storageRefusalOf(cause);
  return refusal === undefined ? cause.summary : NOT_COPIED[refusal];
}
