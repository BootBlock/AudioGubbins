/**
 * Everything an open project writes, in order: its journal records, the states
 * its snapshots keep, its checkpoints and its header (REQ-STOR-021,
 * REQ-STOR-101, REQ-STOR-106).
 *
 * Autosave is the journal itself: every event is queued as a record the moment
 * it is applied, so nothing waits for a save. A checkpoint follows once enough
 * records have been written since the last, or when the session asks for one,
 * as it does when the page is hidden; it captures the project as of the last
 * record queued before it, and queues behind that record. One asked for when
 * storage's checkpoint already holds the project as of that record writes
 * nothing, unless the project was replaced outside the journal, as compaction
 * replaces it. The header follows the project's name whenever the name the
 * state holds changes. Every write goes through one {@link WriteQueue}, so the
 * order is the order of events.
 */

import type { Logger } from '@audiogubbins/diagnostics';
import {
  mapResult,
  succeed,
  type DomainFailureResult,
  type DomainResult,
  type IdGenerator,
} from '@audiogubbins/domain';
import type {
  HistoryNodeId,
  ProjectState,
  StateFingerprint,
  YieldToHost,
} from '@audiogubbins/project-format';

import { writeCheckpointAndHead } from './checkpoint-writing.js';
import { readPair, writeNext } from './generational-pair.js';
import type { JournalEvent } from './journal-events.js';
import { comparePositions, type JournalPosition } from './journal-position.js';
import type { LeaseRecord } from './lease-records.js';
import type { ProjectFiles } from './project-files.js';
import { writeHeader } from './project-header.js';
import type { ProjectModel } from './project-model.js';
import { isAsCheckpointed, type RecoveredProject } from './project-recovery.js';
import type { SegmentLedger } from './segment-ledger.js';
import { isRecordTooLarge } from './storage-failures.js';
import { WriteQueue, type SaveStatus, type WriteOutcome } from './write-queue.js';

/** How often an open project writes a checkpoint and keeps a state. */
export interface WritingCadence {
  /** A checkpoint once this many records have been written since the last. */
  readonly checkpointAfter: number;
}

/** What a writer starts from, and whom it tells what it did. */
export interface WriterStart {
  readonly files: ProjectFiles;
  readonly ids: IdGenerator;
  readonly logger: Logger;

  /** Asked as each checkpoint's segments are planned. */
  readonly yieldToHost: YieldToHost;

  /** The lease the session holds, whose epoch its records are written under. */
  readonly lease: LeaseRecord;

  /** The last record the project as opened includes. */
  readonly position: JournalPosition;

  /**
   * Whether the checkpoint the project was opened from holds it as opened, so
   * a checkpoint before any change would write the same again.
   */
  readonly checkpointed: boolean;
  readonly keptStates: ReadonlySet<StateFingerprint>;
  readonly unwritten: ReadonlyMap<StateFingerprint, ProjectState>;

  /**
   * The segments of history the checkpoint the project was opened from names,
   * which the writer then keeps as each later checkpoint is confirmed.
   */
  readonly segments: SegmentLedger;

  /** The name the header holds, where one could be read. */
  readonly headerName: string | undefined;
  readonly cadence: WritingCadence;

  /** Called whenever the save status may have changed. */
  readonly onChange: () => void;

  /** Called once a checkpoint has named the state at a node. */
  readonly onCheckpoint: (node: HistoryNodeId, state: StateFingerprint) => void;

  /** Called once each checkpoint is written and its head confirmed. */
  readonly onCheckpointWritten: () => void;

  /** Called when a checkpoint finds another window has taken the project. */
  readonly onSuperseded: () => void;
}

/** Whom a session's writer tells what it did. */
export type WriterHooks = Pick<
  WriterStart,
  'onChange' | 'onCheckpoint' | 'onCheckpointWritten' | 'onSuperseded'
>;

/** What a session opened with that its writer starts from. */
export interface WriterOpening {
  readonly recovered: RecoveredProject;
  readonly leaseRecord: LeaseRecord;
  readonly headerName: string | undefined;
  readonly cadence: WritingCadence;
}

/** The writer of a session opened as `start`, over the session's services. */
export function sessionWriterFor(
  services: Pick<WriterStart, 'files' | 'ids' | 'logger' | 'yieldToHost'>,
  start: WriterOpening,
  hooks: WriterHooks,
): SessionWriter {
  const { recovered } = start;
  return new SessionWriter({
    files: services.files,
    ids: services.ids,
    logger: services.logger,
    yieldToHost: services.yieldToHost,
    lease: start.leaseRecord,
    position: recovered.position,
    checkpointed: isAsCheckpointed(recovered),
    keptStates: recovered.keptStates,
    unwritten: recovered.unwritten,
    segments: recovered.segments,
    headerName: start.headerName,
    cadence: start.cadence,
    ...hooks,
  });
}

/** An open project's writes (see the module comment). */
export class SessionWriter {
  readonly queue: WriteQueue;

  /** The states storage holds whole that the history keeps. */
  readonly kept: Set<StateFingerprint>;

  /** States the history keeps that are held only in memory so far. */
  readonly unwritten: Map<StateFingerprint, ProjectState>;

  private readonly start: WriterStart;
  private nextSequence = 1;
  private last: JournalPosition;

  /** The record storage's checkpoint holds the project as of, where it does. */
  private confirmed: JournalPosition | undefined;
  private sinceCheckpoint = 0;
  private headerName: string | undefined;

  constructor(start: WriterStart) {
    this.start = start;
    this.queue = new WriteQueue(start.onChange);
    this.kept = new Set(start.keptStates);
    this.unwritten = new Map(start.unwritten);
    this.last = start.position;
    this.confirmed = start.checkpointed ? start.position : undefined;
    this.headerName = start.headerName;
  }

  get status(): SaveStatus {
    return this.queue.status;
  }

  /**
   * Queues the record of an event applied to the project, which `model` is the
   * project after, and anything that record makes due.
   */
  async append(event: JournalEvent, model: ProjectModel): Promise<WriteOutcome> {
    const position = { epoch: this.start.lease.epoch, sequence: this.nextSequence };
    this.nextSequence += 1;
    this.last = position;
    const record = this.queue.enqueue(
      async () => await this.start.files.journal.append(position, event),
    );
    this.sinceCheckpoint += 1;
    // What the record makes due is queued behind it and awaited with it, so a
    // storage failure in any of them reaches the caller rather than no one.
    const due = [record, this.followName(model.state.project.displayName)];
    if (this.sinceCheckpoint >= this.start.cadence.checkpointAfter)
      due.push(this.checkpoint(model));
    const [written] = await Promise.all(due);
    return written ?? { kind: 'written' };
  }

  /**
   * Queues the keeping of a state whole, where storage does not hold it yet. A
   * state larger than storage can read back stays in memory only, and the
   * journal still holds how to make it again, so it is logged and not retried.
   */
  async keep(state: ProjectState, fingerprint: StateFingerprint): Promise<WriteOutcome> {
    if (this.kept.has(fingerprint)) return { kind: 'written' };
    return await this.queue.enqueue(async () => {
      const kept = await this.start.files.states.put(state);
      if (!kept.ok) return this.notHeld(kept);
      this.kept.add(fingerprint);
      this.unwritten.delete(fingerprint);
      return succeed(undefined);
    });
  }

  /**
   * Queues a checkpoint of `model`, as of the last record queued, which writes
   * nothing where storage's checkpoint is as of that record already. Its
   * outcome is still that of every write queued before it.
   */
  async checkpoint(model: ProjectModel): Promise<WriteOutcome> {
    return await this.queueCheckpoint(model, false);
  }

  /**
   * Queues a checkpoint of `model`, which replaced the project outside the
   * journal, so it is written even where no record was queued since the last.
   */
  async checkpointReplaced(model: ProjectModel): Promise<WriteOutcome> {
    return await this.queueCheckpoint(model, true);
  }

  /**
   * A checkpoint larger than storage can read back is not written, and nothing
   * it would have replaced is removed: the journal holds every change still,
   * and the next checkpoint due tries again.
   */
  private async queueCheckpoint(model: ProjectModel, replaced: boolean): Promise<WriteOutcome> {
    this.sinceCheckpoint = 0;
    const request = {
      id: this.start.ids.next<'CheckpointId'>(),
      model,
      position: this.last,
      lease: this.start.lease,
      unwritten: new Map(this.unwritten),
      ledger: this.start.segments,
      ids: this.start.ids,
      yieldToHost: this.start.yieldToHost,
    };
    return await this.queue.enqueue(async () => {
      // Decided as the write's turn comes, once every checkpoint queued before
      // it has been confirmed or not.
      const current = this.confirmed;
      if (!replaced && current !== undefined && comparePositions(current, request.position) === 0)
        return succeed(undefined);
      this.confirmed = undefined;
      const written = await writeCheckpointAndHead(this.start.files, request);
      if (!written.ok) {
        if (written.failures[0].code === SUPERSEDED) this.start.onSuperseded();
        return this.notHeld(written);
      }
      this.confirmed = request.position;
      const { segments } = written.value;
      this.start.segments.commit(segments.plan, segments.written);
      this.kept.clear();
      for (const state of written.value.keptStates) {
        this.kept.add(state);
        this.unwritten.delete(state);
      }
      const cursor = model.history.cursor;
      const named = written.value.history.nodes.get(cursor)?.stateFingerprint;
      if (named !== undefined) this.start.onCheckpoint(cursor, named);
      this.start.onCheckpointWritten();
      return succeed(undefined);
    });
  }

  /**
   * Passes on a failed write, save one refused as larger than storage can read
   * back, which is logged instead: retrying it would refuse again and hold up
   * every journal record behind it.
   */
  private notHeld(written: DomainFailureResult): DomainResult<void> {
    const [first] = written.failures;
    if (!isRecordTooLarge(first)) return written;
    this.start.logger.warning(
      'Storage cannot hold part of a project whole, so it keeps the journal.',
      {
        kind: String(first.details?.['kind']),
      },
    );
    return succeed(undefined);
  }

  /**
   * Queues a header naming the project as its state now does, if the name
   * changed. The header is the list's copy of the name, so one that cannot be
   * read is logged and left for the catalogue to report, never allowed to hold
   * up the journal behind it.
   */
  private async followName(name: string): Promise<WriteOutcome> {
    if (name === this.headerName) return { kind: 'written' };
    this.headerName = name;
    const { files, logger } = this.start;
    return await this.queue.enqueue(async () => {
      const current = await readPair(files.records, files.header);
      const newest = current.valid[0]?.value;
      if (newest === undefined) {
        logger.warning('A project’s header cannot be read, so its name was not written.', {
          count: current.faults.length,
        });
        return succeed(undefined);
      }
      return mapResult(
        await writeNext(files.records, files.header, current, (generation) =>
          writeHeader({ ...newest, generation, name }),
        ),
        () => undefined,
      );
    });
  }
}

/** The code of the failure a checkpoint gives where the lease was taken. */
const SUPERSEDED = 'storage.lease-superseded';
