/**
 * When a project's policy makes a backup generation, and which generations its
 * retention keeps (REQ-STOR-105, REQ-STOR-106).
 *
 * Both are pure functions of the policy, the history and the generations, so
 * the rules are tested apart from any storage and the scheduler only asks.
 * Activity is read from the history itself: the changes made since the last
 * generation are the change nodes made after it, so nothing counts changes on
 * the side. A generation is made only where something changed since the last,
 * so an idle project makes none however long it stays open.
 *
 * Pruning never removes a protected generation, nor one the person made by
 * hand, whatever the limits; the others are kept while they are within every
 * limit set, counted newest first, and removed otherwise.
 */

import type { History } from '@audiogubbins/history';
import type { BackupPolicy, BackupRetention } from '@audiogubbins/project-format';

/** Why a generation was made. */
export type BackupReason =
  /** The policy's interval passed with changes made. */
  | 'time'
  /** The policy's number of changes was saved. */
  | 'save'
  /** The person asked for one. */
  | 'manual';

/** A backup generation, as the list of them shows it. */
export interface BackupGeneration {
  /** Its number, which grows with each generation of the project. */
  readonly number: number;

  /** When it was made, in milliseconds since the epoch. */
  readonly at: number;
  readonly reason: BackupReason;

  /** The bytes its checkpoint and states take; the media it names is shared. */
  readonly bytes: number;
  readonly protected: boolean;
}

const MINUTE = 60_000;
const DAY = 86_400_000;

/**
 * Why a generation is due now, or `undefined` where none is: `lastAt` is when
 * the newest generation was made, or `undefined` where there is none.
 */
export function backupDue(
  policy: BackupPolicy,
  history: History,
  lastAt: number | undefined,
  now: number,
): BackupReason | undefined {
  if (policy.kind === 'off') return undefined;
  let changes = 0;
  let firstChange = Number.POSITIVE_INFINITY;
  for (const node of history.nodes.values()) {
    if (node.kind === 'change' && (lastAt === undefined || node.at > lastAt)) {
      changes += 1;
      firstChange = Math.min(firstChange, node.at);
    }
  }
  if (changes === 0) return undefined;
  const { everyChanges, everyMinutes } = policy.trigger;
  if (everyChanges !== undefined && changes >= everyChanges) return 'save';
  const since = lastAt ?? firstChange;
  return everyMinutes !== undefined && now - since >= everyMinutes * MINUTE ? 'time' : undefined;
}

/** What pruning would remove, and what it would free. */
export interface BackupPruning {
  /** The generations to remove, newest first. */
  readonly removed: readonly BackupGeneration[];
  readonly bytes: number;
}

/** The generations a retention does not keep (see the module comment). */
export function planBackupPruning(
  generations: readonly BackupGeneration[],
  retention: BackupRetention,
  now: number,
): BackupPruning {
  const prunable = generations
    .filter((generation) => !generation.protected && generation.reason !== 'manual')
    .sort((one, other) => other.number - one.number);
  let held = 0;
  const removed = prunable.filter((generation, index) => {
    held += generation.bytes;
    const kept =
      (retention.count === undefined || index < retention.count) &&
      (retention.days === undefined || now - generation.at <= retention.days * DAY) &&
      (retention.bytes === undefined || held <= retention.bytes);
    return !kept;
  });
  return { removed, bytes: removed.reduce((sum, generation) => sum + generation.bytes, 0) };
}
