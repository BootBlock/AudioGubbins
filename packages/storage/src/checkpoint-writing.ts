/**
 * Writing a checkpoint and a head naming it, then removing what the new head
 * replaced (ADR-0020, REQ-STOR-021, REQ-STOR-098, REQ-STOR-101).
 *
 * The order is what makes a crash at any step harmless. The states the
 * checkpoint keeps are written first, then the checkpoint, then the head that
 * names it, which is read back before it counts; until then every earlier head
 * and everything it names are untouched. Only once the new head is confirmed
 * are the earlier heads and checkpoints, the states nothing keeps any longer,
 * the journal records the checkpoint includes and the superseded lease records
 * removed, and records no checkpoint includes are set aside instead. A crash
 * while removing leaves files the next checkpoint removes.
 *
 * A writer that lost the project may still be running this, late, at any step:
 * a tab the browser froze does. Its lease is read before the head is written
 * and again before anything is removed, and where the epoch is no longer the
 * one it holds, it goes no further. Between that second reading and the
 * removals, another opening may take the project, and the removals are safe all
 * the same, for this reason. An opening claims its epoch before it reads
 * anything (`lease-records.ts`), so one that claimed after the second reading
 * reads the heads after this head was confirmed, and recovers from it or from
 * one newer; and one that claimed before it made that reading fail. So what an
 * opening recovers from is never among what this writer removes: only heads and
 * checkpoints of its own epoch or earlier ones, older than its newest; the
 * journal up to its newest head's position; lease records of earlier epochs;
 * and states its newest head does not keep, as listed before the lease was
 * read. Every file a later writer writes is of a later epoch or a state written
 * after that listing, and none of those is touched. Each head is a file of its
 * own (`project-heads.ts`), so no late write overwrites another writer's head.
 *
 * One window remains, and it is bounded: states are named by their content
 * alone, so a later writer that reaches a state identical to one this writer is
 * about to remove, and finds that file already whole, may have it removed under
 * it. Its next opening then finds the state missing, says so, and makes it
 * again by replay from an earlier kept state, checked against its fingerprint;
 * no state is ever read as another.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';
import { retainedStates, withStateFingerprint, type History } from '@audiogubbins/history';
import type { ProjectState, StateFingerprint } from '@audiogubbins/project-format';

import type { Checkpoint } from './checkpoint-record.js';
import type { JournalPosition } from './journal-position.js';
import { isHeldBy, readLease, type LeaseRecord } from './lease-records.js';
import type { ProjectFiles } from './project-files.js';
import { writeHead, type ProjectHead } from './project-heads.js';
import type { ProjectModel } from './project-model.js';
import {
  epochOfCheckpoint,
  epochOfLease,
  headOfName,
  type CheckpointId,
} from './storage-layout.js';

/** What a checkpoint is made of. */
export interface CheckpointRequest {
  readonly id: CheckpointId;
  readonly model: ProjectModel;

  /** The last journal record the model includes. */
  readonly position: JournalPosition;

  /** The lease the writer holds. */
  readonly lease: LeaseRecord;

  /** States the history keeps that are held only in memory so far. */
  readonly unwritten: ReadonlyMap<StateFingerprint, ProjectState>;
}

/** A checkpoint written and made current. */
export interface WrittenCheckpoint {
  /** The history, its cursor now naming its state. */
  readonly history: History;
  readonly keptStates: ReadonlySet<StateFingerprint>;
  readonly head: ProjectHead;
}

/** Writes a checkpoint and a head naming it, and removes what it replaced. */
export async function writeCheckpointAndHead(
  files: ProjectFiles,
  request: CheckpointRequest,
  signal?: AbortSignal,
): Promise<DomainResult<WrittenCheckpoint>> {
  const { model, lease } = request;
  const cursorState = await files.states.put(model.state, signal);
  const named = withStateFingerprint(model.history, model.history.cursor, cursorState);
  if (!named.ok) return named;
  const history = named.value;

  const retained = retainedStates(history);
  for (const [fingerprint, state] of request.unwritten) {
    if (retained.has(fingerprint)) await files.states.put(state, signal);
  }
  const held = await files.states.list();
  const keptStates = new Set([...retained].filter((state) => held.has(state)));

  const checkpoint: Checkpoint = {
    history,
    cursorState,
    keptStates,
    exports: model.exports,
    retention: model.retention,
    backup: model.backup,
    ...(model.comparison === undefined ? {} : { comparison: model.comparison }),
    leaseEpoch: lease.epoch,
  };
  await files.writeCheckpoint(request.id, checkpoint, signal);

  if (!isHeldBy(await readLease(files.records, files.paths, signal), lease)) {
    return fail(leaseSuperseded());
  }
  const head = await writeHead(
    files.records,
    files.paths,
    { epoch: lease.epoch, checkpoint: request.id, journal: request.position },
    signal,
  );
  if (!head.ok) return head;

  // Read again, however briefly after the first: removing is the one step a
  // writer that lost the project could harm another's files with.
  const still = await readLease(files.records, files.paths, signal);
  if (!isHeldBy(still, lease)) return fail(leaseSuperseded());
  const unkept = [...held].filter((state) => !keptStates.has(state));
  await removeReplaced(files, head.value, unkept, still.current);
  return succeed({ history, keptStates, head: head.value });
}

/** Removes what a confirmed head replaced, of its own epoch and earlier ones only. */
async function removeReplaced(
  files: ProjectFiles,
  head: ProjectHead,
  unkept: readonly StateFingerprint[],
  lease: LeaseRecord,
): Promise<void> {
  const tree = files.records.tree;
  for (const entry of await tree.list(files.paths.heads)) {
    const named = headOfName(entry.name);
    const older =
      named !== undefined &&
      (named.epoch < head.epoch ||
        (named.epoch === head.epoch && named.generation < head.generation));
    if (older) await tree.remove(`${files.paths.heads}/${entry.name}`);
  }
  const current = files.paths.checkpoint(head.epoch, head.checkpoint);
  for (const entry of await tree.list(files.paths.checkpoints)) {
    const path = `${files.paths.checkpoints}/${entry.name}`;
    const epoch = epochOfCheckpoint(entry.name);
    if (epoch !== undefined && epoch <= head.epoch && path !== current) await tree.remove(path);
  }
  for (const state of unkept) await files.states.remove(state);
  await files.journal.prune(head.journal, lease);
  for (const entry of await tree.list(files.paths.leases)) {
    const epoch = epochOfLease(entry.name);
    if (epoch !== undefined && epoch < lease.epoch) await tree.remove(files.paths.lease(epoch));
  }
}

function leaseSuperseded(): DomainFailure {
  return failure(
    'storage.lease-superseded',
    FailureKind.Conflict,
    'Another window has taken the project, so this one no longer writes it.',
  );
}
