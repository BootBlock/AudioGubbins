/**
 * Writing a checkpoint and moving the head to it, then removing what the new
 * checkpoint replaced (ADR-0020, REQ-STOR-021, REQ-STOR-101).
 *
 * The order is what makes a crash at any step harmless. The states the
 * checkpoint keeps are written first, then the checkpoint, then the head that
 * names it, which is read back before it counts; until then the previous head
 * and everything it names are untouched. Only once the new head is confirmed
 * are the previous checkpoints, the states nothing keeps any longer, the
 * journal records the checkpoint includes and the superseded lease records
 * removed, and records no checkpoint includes are set aside instead. A crash
 * while removing leaves files the next checkpoint removes.
 *
 * Before the head is written the lease is read again: a writer whose epoch is
 * no longer current has lost the project, and moves nothing.
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
import { readPair, writeNext, type Slotted } from './generational-pair.js';
import type { JournalPosition } from './journal-position.js';
import { readLease, type LeaseRecord } from './lease-records.js';
import type { ProjectFiles } from './project-files.js';
import { writeHead, type ProjectHead } from './project-heads.js';
import type { ProjectModel } from './project-model.js';
import { epochOfLease, type CheckpointId } from './storage-layout.js';

/** What a checkpoint is made of. */
export interface CheckpointRequest {
  readonly id: CheckpointId;
  readonly model: ProjectModel;

  /** The last journal record the model includes. */
  readonly position: JournalPosition;

  /** The epoch of the lease the writer holds. */
  readonly leaseEpoch: number;

  /** States the history keeps that are held only in memory so far. */
  readonly unwritten: ReadonlyMap<StateFingerprint, ProjectState>;
}

/** A checkpoint written and made current. */
export interface WrittenCheckpoint {
  /** The history, its cursor now naming its state. */
  readonly history: History;
  readonly keptStates: ReadonlySet<StateFingerprint>;
  readonly head: Slotted<ProjectHead>;
}

/** Writes a checkpoint, moves the head to it, and removes what it replaced. */
export async function writeCheckpointAndHead(
  files: ProjectFiles,
  request: CheckpointRequest,
  signal?: AbortSignal,
): Promise<DomainResult<WrittenCheckpoint>> {
  const { model } = request;
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
    leaseEpoch: request.leaseEpoch,
  };
  await files.writeCheckpoint(request.id, checkpoint, signal);

  const lease = await readLease(files.records, files.paths, signal);
  if (lease.current.epoch !== request.leaseEpoch) return fail(leaseSuperseded());

  const heads = await readPair(files.records, files.heads, signal);
  const head = await writeNext(
    files.records,
    files.heads,
    heads,
    (generation) => writeHead({ generation, checkpoint: request.id, journal: request.position }),
    signal,
  );
  if (!head.ok) return head;

  // Read again, however briefly after the first: removing is the one step a
  // writer that lost the project could harm another's files with.
  const still = await readLease(files.records, files.paths, signal);
  if (still.current.epoch !== request.leaseEpoch) return fail(leaseSuperseded());
  await removeReplaced(files, request, keptStates, still.current);
  return succeed({ history, keptStates, head: head.value });
}

/** Removes what a confirmed checkpoint replaced. */
async function removeReplaced(
  files: ProjectFiles,
  request: CheckpointRequest,
  keptStates: ReadonlySet<StateFingerprint>,
  lease: LeaseRecord,
): Promise<void> {
  const tree = files.records.tree;
  for (const entry of await tree.list(files.paths.checkpoints)) {
    if (entry.name !== `${request.id}.json`)
      await tree.remove(`${files.paths.checkpoints}/${entry.name}`);
  }
  for (const state of await files.states.list()) {
    if (!keptStates.has(state)) await files.states.remove(state);
  }
  await files.journal.prune(request.position, lease);
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
