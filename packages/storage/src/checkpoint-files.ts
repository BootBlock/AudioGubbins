/**
 * Reading and writing a checkpoint with the segments of history it names
 * (ADR-0020, REQ-STOR-101).
 *
 * A checkpoint is written after the segments it names, so a checkpoint whose
 * write is cut short names nothing that is missing, and one that is read whole
 * names segments that are whole or says why not: a segment missing or failing
 * its check makes the checkpoint invalid, as a damaged checkpoint is, and an
 * earlier head serves instead. A project's checkpoints share one directory of
 * segments, and a backup generation has its own, so it stays whole after its
 * project is gone.
 */

import { FailureKind, failure, succeed, type DomainResult } from '@audiogubbins/domain';
import type { History, HistoryNode } from '@audiogubbins/history';
import {
  canonicalJson,
  readHistorySegment,
  startReading,
  writeHistoryNodeRecord,
  writeHistorySegment,
  type HistorySegmentId,
  type HistorySegmentRecord,
  type HistorySegmentReference,
  type Turns,
} from '@audiogubbins/project-format';

import {
  type CheckedReading,
  type CheckedRecords,
  RecordKind,
  type RecordFault,
} from './checked-records.js';
import {
  checkpointOf,
  readCheckpointRecord,
  writeCheckpoint,
  type Checkpoint,
} from './checkpoint-record.js';
import { SegmentLedger, type HeldSegment, type SegmentPlan } from './segment-ledger.js';

/** A checkpoint read whole, with the ledger of the segments it names. */
export interface StoredCheckpoint extends Checkpoint {
  readonly segments: SegmentLedger;
}

/** A checkpoint written, and what its ledger takes once it is confirmed. */
export interface WrittenSegments {
  readonly plan: SegmentPlan;
  readonly written: readonly HeldSegment[];

  /** Every segment the checkpoint names. */
  readonly named: readonly HistorySegmentReference[];
}

/** The path of a segment's file. */
export type SegmentPath = (segment: HistorySegmentReference) => string;

/** What a checkpoint's segments are planned from, and how a new one is named. */
export interface SegmentWriting {
  readonly ledger: SegmentLedger;

  /** A new segment's identifier, never one given before beside it. */
  readonly next: () => HistorySegmentId;
}

/** The length of a node's text, as a segment holds it. */
const measured = (node: HistoryNode): number => canonicalJson(writeHistoryNodeRecord(node)).length;

/** Checkpoints and the segments they name, in one place. */
export class CheckpointFiles {
  private readonly records: CheckedRecords;
  private readonly segmentPath: SegmentPath;

  constructor(records: CheckedRecords, segmentPath: SegmentPath) {
    this.records = records;
    this.segmentPath = segmentPath;
  }

  /** The checkpoint at `path`, read whole with every segment it names. */
  async read(path: string, signal?: AbortSignal): Promise<CheckedReading<StoredCheckpoint>> {
    const record = await this.records.read(
      path,
      RecordKind.Checkpoint,
      readCheckpointRecord,
      signal,
    );
    if (record.kind !== 'valid') return record;
    const segments: HistorySegmentRecord[] = [];
    const held: HeldSegment[] = [];
    for (const reference of record.value.history.segments) {
      const segment = await this.records.read(
        this.segmentPath(reference),
        RecordKind.HistorySegment,
        readHistorySegment,
        signal,
      );
      if (segment.kind !== 'valid') return { kind: 'invalid', fault: segmentFault(segment) };
      segments.push(segment.value);
      held.push({ reference, nodes: segment.value.nodes, length: undefined });
    }
    const reading = startReading();
    const checkpoint = reading.outcome(checkpointOf(reading, record.value, segments, 'body'));
    if (!checkpoint.ok) {
      return { kind: 'invalid', fault: { kind: 'malformed', failures: checkpoint.failures } };
    }
    // Only the newest segment's length is wanted: it is the one a later
    // checkpoint may merge new nodes into.
    const newest = held.pop();
    if (newest !== undefined) {
      const file = await this.records.tree.openFile(this.segmentPath(newest.reference));
      held.push({ ...newest, length: file?.size });
    }
    return { kind: 'valid', value: { ...checkpoint.value, segments: new SegmentLedger(held) } };
  }

  /**
   * Writes the segments the ledger plans for `checkpoint`'s history, then the
   * checkpoint at `path`, failing as {@link CheckedRecords.write} does. The
   * ledger is left as it was, for the caller to commit once the checkpoint is
   * confirmed. Planning looks at every node, a step of `turns` each.
   */
  async write(
    path: string,
    checkpoint: Checkpoint,
    segments: SegmentWriting,
    turns: Turns,
  ): Promise<DomainResult<WrittenSegments>> {
    const { signal } = turns;
    const plan = await segments.ledger.plan(checkpoint.history, measured, turns);
    const written: HeldSegment[] = [];
    for (const fresh of plan.fresh) {
      const reference = { epoch: checkpoint.leaseEpoch, id: segments.next() };
      const saved = await this.records.write(
        this.segmentPath(reference),
        RecordKind.HistorySegment,
        writeHistorySegment(segmentOf(checkpoint.history, fresh.nodes)),
        signal,
      );
      if (!saved.ok) return saved;
      written.push({ reference, nodes: fresh.nodes, length: fresh.length });
    }
    const named = [
      ...plan.kept.map((segment) => segment.reference),
      ...written.map((segment) => segment.reference),
    ];
    const saved = await this.records.write(
      path,
      RecordKind.Checkpoint,
      writeCheckpoint(checkpoint, { segments: named, fingerprints: plan.fingerprints }),
      signal,
    );
    if (!saved.ok) return saved;
    return succeed({ plan, written, named });
  }
}

function segmentOf(history: History, nodes: readonly HistoryNode[]): HistorySegmentRecord {
  return { project: history.project, nodes };
}

/** Why a checkpoint whose segment could not be read is invalid. */
function segmentFault(segment: Exclude<CheckedReading<unknown>, { kind: 'valid' }>): RecordFault {
  return {
    kind: 'malformed',
    failures: [
      failure(
        segment.kind === 'absent' ? 'checkpoint.segment-missing' : 'checkpoint.segment-unreadable',
        FailureKind.IntegrityViolation,
        segment.kind === 'absent'
          ? 'A segment of history the checkpoint names is missing.'
          : 'A segment of history the checkpoint names cannot be read.',
        { details: { fault: segment.kind === 'absent' ? 'absent' : segment.fault.kind } },
      ),
    ],
  };
}
