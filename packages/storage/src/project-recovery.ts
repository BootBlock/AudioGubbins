/**
 * Rebuilding an open project from storage: the head, its checkpoint, the state
 * at the checkpoint's cursor, then every journal record after it (REQ-STOR-021,
 * REQ-STOR-101, the packet's "Failure and Recovery Behaviour").
 *
 * The valid heads are tried newest first, by lease epoch and then by generation
 * (`project-heads.ts`). A head is passed over, and the next tried, where it is
 * fenced by the lease (a writer that lost the project wrote it past what the
 * next writer read), where its checkpoint cannot be read, or where the state at
 * its cursor can be neither read nor rebuilt. A cursor state that fails its
 * check is rebuilt from the nearest earlier state the checkpoint keeps, by
 * replaying the changes between, and must come out as the state the checkpoint
 * names. Replay then applies each record in order, through the same functions a
 * session applied it with, and stops at the first that is invalid or that the
 * command layer will not apply again.
 *
 * Nothing is repaired silently (REQ-STOR-101). Every head passed over, the
 * records replayed, the break and every record discarded past it, the fenced
 * records, a rebuilt cursor state and every kept state missing are in the
 * report, and so is every recording a crash cut short
 * (`recording-sessions.ts`), which the person is offered before anything is
 * cleaned. Recovery reads and never writes: sealing and setting aside are done
 * by the writer that opens the project, and a reader changes nothing.
 */

import type { CommandBus } from '@audiogubbins/commands';
import type { Logger } from '@audiogubbins/diagnostics';
import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';
import { restorationOf, retainedStates } from '@audiogubbins/history';
import type { ProjectState, StateFingerprint, YieldToHost } from '@audiogubbins/project-format';

import type { RecordFault } from './checked-records.js';
import type { StoredCheckpoint } from './checkpoint-files.js';
import type { Checkpoint } from './checkpoint-record.js';
import type { JournalBreak } from './command-journal.js';
import { replayEvent, type ReplayContext } from './journal-replay.js';
import type { JournalPosition } from './journal-position.js';
import { sealOf, type LeaseRecord } from './lease-records.js';
import type { ProjectFiles } from './project-files.js';
import type { SegmentLedger } from './segment-ledger.js';
import { readHeads, type ProjectHead } from './project-heads.js';
import type { ProjectModel } from './project-model.js';
import { replayInvocations } from './history-moves.js';
import { replayDiverged } from './storage-failures.js';
import {
  listRecordings,
  type InterruptedRecording,
  type RecordingListing,
} from './recording-sessions.js';

/** Why a head was passed over. */
export type HeadFallbackReason =
  | { readonly kind: 'head-invalid'; readonly fault: RecordFault }
  | { readonly kind: 'head-fenced' }
  | { readonly kind: 'checkpoint-missing' }
  | { readonly kind: 'checkpoint-invalid'; readonly fault: RecordFault }
  | { readonly kind: 'cursor-state-unusable'; readonly failure: DomainFailure };

/** A head passed over, and why. */
export interface HeadFallback {
  /** The head's file. */
  readonly path: string;
  readonly reason: HeadFallbackReason;
}

/** What recovery found and did, for the person and the diagnostic log. */
export interface ProjectRecoveryReport {
  /** The head the project was opened from. */
  readonly head: { readonly epoch: number; readonly generation: number };
  readonly fallbacks: readonly HeadFallback[];

  /** How many journal records were replayed after the checkpoint. */
  readonly replayed: number;

  /** Where replay stopped short of the journal's end, if it did. */
  readonly journalBreak?: JournalBreak;

  /** Records of a writer that had lost the project, never replayed. */
  readonly fenced: readonly JournalPosition[];

  /** The cursor state's failure, where it was rebuilt from an earlier state. */
  readonly rebuiltCursorState?: DomainFailure;

  /** States the history keeps that storage does not hold. */
  readonly missingStates: readonly StateFingerprint[];

  /**
   * Recordings cut short before they became assets, each offered to be
   * recovered or discarded before anything is cleaned (ADR-0071).
   */
  readonly interruptedRecordings: readonly InterruptedRecording[];
}

/** A project rebuilt from storage. */
export interface RecoveredProject {
  readonly model: ProjectModel;

  /** The last journal record the model includes. */
  readonly position: JournalPosition;

  /** The last record replayed in each epoch from the head's, for sealing. */
  readonly lastReplayed: ReadonlyMap<number, number>;

  /** The states storage holds whole that the history keeps. */
  readonly keptStates: ReadonlySet<StateFingerprint>;

  /** States the history keeps that replay rebuilt and storage does not yet hold. */
  readonly unwritten: ReadonlyMap<StateFingerprint, ProjectState>;

  /** The segments of history the checkpoint recovered from names. */
  readonly segments: SegmentLedger;

  /** The project's recording sessions that are not yet assets. */
  readonly recordings: RecordingListing;
  readonly report: ProjectRecoveryReport;
}

/**
 * Whether the checkpoint a project was opened from holds it as opened: nothing
 * replayed after it, and every state it keeps held whole as it names it.
 */
export function isAsCheckpointed(recovered: RecoveredProject): boolean {
  const { report, unwritten } = recovered;
  return (
    report.replayed === 0 &&
    unwritten.size === 0 &&
    report.rebuiltCursorState === undefined &&
    report.missingStates.length === 0
  );
}

/** What recovery needs besides the project's files. */
export interface RecoveryServices {
  readonly bus: CommandBus<ProjectState>;
  readonly logger: Logger;

  /** Asked through work over history, records or bytes held in memory. */
  readonly yieldToHost: YieldToHost;
}

/** Rebuilds a project from storage under the lease's seals. */
export async function recoverProject(
  files: ProjectFiles,
  lease: LeaseRecord,
  services: RecoveryServices,
  signal?: AbortSignal,
): Promise<DomainResult<RecoveredProject>> {
  const heads = await readHeads(files.records, files.paths, signal);
  const fallbacks: HeadFallback[] = heads.faults.map(({ path, fault }) => ({
    path,
    reason: { kind: 'head-invalid', fault },
  }));

  for (const head of heads.valid) {
    const start = await startFrom(files, head, lease, services, signal);
    if (!start.ok) {
      fallbacks.push(start.fallback);
      continue;
    }
    return succeed(await replayAfter(files, head, start, lease, fallbacks, services, signal));
  }
  return fail(
    failure(
      'storage.no-usable-head',
      FailureKind.IntegrityViolation,
      'Neither of the project’s commit points leads to a state that can be read.',
      { details: { project: files.project, fallbacks: fallbacks.length } },
    ),
  );
}

/** The checkpoint a head names and the state at its cursor, or why neither serves. */
type Start =
  | {
      readonly ok: true;
      readonly checkpoint: StoredCheckpoint;
      readonly state: ProjectState;
      readonly held: ReadonlySet<StateFingerprint>;
      readonly rebuilt?: DomainFailure;
    }
  | { readonly ok: false; readonly fallback: HeadFallback };

async function startFrom(
  files: ProjectFiles,
  head: ProjectHead,
  lease: LeaseRecord,
  services: RecoveryServices,
  signal?: AbortSignal,
): Promise<Start> {
  const passOver = (reason: HeadFallbackReason): Start => ({
    ok: false,
    fallback: { path: files.paths.head(head.epoch, head.generation), reason },
  });
  if (isFenced(head.journal, lease)) return passOver({ kind: 'head-fenced' });

  const read = await files.readCheckpoint(head.epoch, head.checkpoint, signal);
  if (read.kind === 'absent') return passOver({ kind: 'checkpoint-missing' });
  if (read.kind === 'invalid') return passOver({ kind: 'checkpoint-invalid', fault: read.fault });
  const checkpoint = read.value;

  const held = await files.states.list();
  const state = await files.states.get(checkpoint.cursorState, signal);
  if (state.ok) return { ok: true, checkpoint, state: state.value, held };

  const rebuilt = await rebuildCursorState(files, checkpoint, held, services, signal);
  return rebuilt.ok
    ? { ok: true, checkpoint, state: rebuilt.value, held, rebuilt: state.failures[0] }
    : passOver({ kind: 'cursor-state-unusable', failure: state.failures[0] });
}

/** Whether a head's position lies past the seal of its epoch. */
function isFenced(position: JournalPosition, lease: LeaseRecord): boolean {
  if (position.epoch > lease.epoch) return true;
  const seal = sealOf(lease, position.epoch);
  return seal !== undefined && position.sequence > seal;
}

/**
 * The cursor's state rebuilt from the nearest earlier state the checkpoint
 * keeps, refused unless it comes out as the state the checkpoint names.
 */
async function rebuildCursorState(
  files: ProjectFiles,
  checkpoint: Checkpoint,
  held: ReadonlySet<StateFingerprint>,
  services: RecoveryServices,
  signal?: AbortSignal,
): Promise<DomainResult<ProjectState>> {
  const { history, cursorState } = checkpoint;
  const restoration = restorationOf(
    history,
    history.cursor,
    (state) => state !== cursorState && held.has(state) && checkpoint.keptStates.has(state),
  );
  if (!restoration.ok) return restoration;
  const base = await files.states.get(restoration.value.baseState, signal);
  if (!base.ok) return base;
  const replayed = replayInvocations(
    services.bus,
    base.value,
    restoration.value.redo.flatMap((node) => node.forward),
  );
  if (!replayed.ok) return replayed;
  if ((await files.states.fingerprint(replayed.value)) !== cursorState) {
    return fail(replayDiverged());
  }
  return succeed(replayed.value);
}

/** Replays the journal after a head onto its checkpoint. */
async function replayAfter(
  files: ProjectFiles,
  head: ProjectHead,
  start: Extract<Start, { ok: true }>,
  lease: LeaseRecord,
  fallbacks: readonly HeadFallback[],
  services: RecoveryServices,
  signal?: AbortSignal,
): Promise<RecoveredProject> {
  const { checkpoint, held } = start;
  // A cursor state rebuilt is held only in memory until it is written whole
  // again: its file is there, but not what its name promises.
  const damaged = start.rebuilt === undefined ? undefined : checkpoint.cursorState;
  const context: ReplayContext = {
    files,
    bus: services.bus,
    logger: services.logger,
    kept: new Set(
      [...checkpoint.keptStates].filter((state) => held.has(state) && state !== damaged),
    ),
    unwritten: new Map(damaged === undefined ? [] : [[damaged, start.state]]),
  };
  const model: ProjectModel = {
    state: start.state,
    history: checkpoint.history,
    exports: checkpoint.exports,
    retention: checkpoint.retention,
    backup: checkpoint.backup,
    ...(checkpoint.comparison === undefined ? {} : { comparison: checkpoint.comparison }),
  };
  const replay = await replayJournal(model, head.journal, lease, context, signal);
  const missingStates = [...retainedStates(replay.model.history)].filter(
    (state) => !held.has(state) && !context.unwritten.has(state),
  );
  const recordings = await listRecordings(files.records, files.project, replay.model.state, signal);
  return {
    model: replay.model,
    position: replay.position,
    lastReplayed: replay.lastReplayed,
    keptStates: context.kept,
    segments: checkpoint.segments,
    unwritten: context.unwritten,
    recordings,
    report: {
      head: { epoch: head.epoch, generation: head.generation },
      fallbacks,
      replayed: replay.replayed,
      ...(replay.journalBreak === undefined ? {} : { journalBreak: replay.journalBreak }),
      fenced: replay.fenced,
      ...(start.rebuilt === undefined ? {} : { rebuiltCursorState: start.rebuilt }),
      missingStates,
      interruptedRecordings: recordings.interrupted,
    },
  };
}

/** What replaying a journal onto a model came to. */
interface Replay {
  readonly model: ProjectModel;
  readonly position: JournalPosition;
  readonly lastReplayed: ReadonlyMap<number, number>;
  readonly replayed: number;
  readonly journalBreak?: JournalBreak;
  readonly fenced: readonly JournalPosition[];
}

/** Applies each record after `from` in order, until one is invalid or refused. */
async function replayJournal(
  start: ProjectModel,
  from: JournalPosition,
  lease: LeaseRecord,
  context: ReplayContext,
  signal?: AbortSignal,
): Promise<Replay> {
  const plan = await context.files.journal.readAfter(from, lease, signal);
  let model = start;
  let position = from;
  let replayed = 0;
  const lastReplayed = new Map([[from.epoch, from.sequence]]);
  let journalBreak: JournalBreak | undefined;
  for (const next of plan.readable) {
    const read = await context.files.journal.read(next, signal);
    if (read.kind !== 'valid') {
      journalBreak = plan.breakAt(
        next,
        read.kind === 'invalid' ? { kind: 'invalid', fault: read.fault } : { kind: 'missing' },
      );
      break;
    }
    const applied = await replayEvent(model, read.value, context, signal);
    if (!applied.ok) {
      journalBreak = plan.breakAt(next, { kind: 'refused', failure: applied.failures[0] });
      break;
    }
    model = applied.value;
    position = next;
    replayed += 1;
    lastReplayed.set(next.epoch, next.sequence);
  }
  journalBreak ??= plan.end();
  return {
    model,
    position,
    lastReplayed,
    replayed,
    ...(journalBreak === undefined ? {} : { journalBreak }),
    fenced: plan.fenced,
  };
}
