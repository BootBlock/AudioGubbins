/**
 * A project's journal of history events: the `CommandJournal` the packet names
 * (ADR-0020, REQ-STOR-021, REQ-STOR-098, REQ-STOR-101).
 *
 * Each event is one checked record, `journal/e<epoch>/<sequence>.json`, written
 * once. Appending writes one record; the session writes them in order and never
 * two at once. Reading plans the records after a position first, from the names
 * alone: those to replay in order, the first one missing where the numbering
 * breaks off, every record present after that break, and every record of a
 * sealed epoch past its seal, which is fenced and never replayed. Recovery then
 * reads the records to replay one by one and stops at the first that fails its
 * check or will not apply; whatever lies past that point is the discarded tail,
 * reported by position and set aside in the quarantine rather than deleted
 * (REQ-STOR-101: recovery from a torn tail, never unseen).
 */

import type { DomainFailure, DomainResult, ProjectId } from '@audiogubbins/domain';

import type { CheckedReading, CheckedRecords, RecordFault } from './checked-records.js';
import { RecordKind } from './checked-records.js';
import { readEvent, writeEvent, type JournalEvent } from './journal-events.js';
import { comparePositions, type JournalPosition } from './journal-position.js';
import { sealOf, type LeaseRecord } from './lease-records.js';
import { ProjectPaths, epochOfDirectory, sequenceOfRecord } from './storage-layout.js';

/** Why replay stopped short of the journal's end. */
export type BreakReason =
  | { readonly kind: 'missing' }
  | { readonly kind: 'invalid'; readonly fault: RecordFault }
  | { readonly kind: 'refused'; readonly failure: DomainFailure };

/** Where replay stopped, why, and every record present from there on. */
export interface JournalBreak {
  readonly at: JournalPosition;
  readonly reason: BreakReason;
  readonly discarded: readonly JournalPosition[];
}

/** The records after a position, planned from their names. */
export class JournalPlan {
  /** The records to replay, in order, numbered without a gap. */
  readonly readable: readonly JournalPosition[];

  /** Records of a sealed epoch past its seal. */
  readonly fenced: readonly JournalPosition[];

  /** The first record missing where the numbering breaks off, if it does. */
  private readonly missing: JournalPosition | undefined;

  /** Every record present after `missing`. */
  private readonly beyond: readonly JournalPosition[];

  constructor(
    readable: readonly JournalPosition[],
    fenced: readonly JournalPosition[],
    missing: JournalPosition | undefined,
    beyond: readonly JournalPosition[],
  ) {
    this.readable = readable;
    this.fenced = fenced;
    this.missing = missing;
    this.beyond = beyond;
  }

  /** The break at a record to replay that could not be. */
  breakAt(at: JournalPosition, reason: BreakReason): JournalBreak {
    return {
      at,
      reason,
      discarded: [
        ...this.readable.filter((position) => comparePositions(position, at) >= 0),
        ...this.beyond,
      ],
    };
  }

  /** The break where the numbering breaks off with records after it, if it does. */
  end(): JournalBreak | undefined {
    return this.missing === undefined
      ? undefined
      : { at: this.missing, reason: { kind: 'missing' }, discarded: this.beyond };
  }
}

/** One project's journal. */
export class CommandJournal {
  private readonly records: CheckedRecords;
  private readonly paths: ProjectPaths;

  constructor(records: CheckedRecords, project: ProjectId) {
    this.records = records;
    this.paths = new ProjectPaths(project);
  }

  /**
   * Writes one event at a position. Rejects with the tree's refusal, and fails
   * as {@link CheckedRecords.write} does.
   */
  async append(
    position: JournalPosition,
    event: JournalEvent,
    signal?: AbortSignal,
  ): Promise<DomainResult<void>> {
    return await this.records.write(
      this.paths.record(position.epoch, position.sequence),
      RecordKind.JournalRecord,
      writeEvent(event),
      signal,
    );
  }

  /** The event at a position, checked. */
  async read(
    position: JournalPosition,
    signal?: AbortSignal,
  ): Promise<CheckedReading<JournalEvent>> {
    return await this.records.read(
      this.paths.record(position.epoch, position.sequence),
      RecordKind.JournalRecord,
      readEvent,
      signal,
    );
  }

  /** Plans the records after `from` under the seals of `lease`. */
  async readAfter(from: JournalPosition, lease: LeaseRecord): Promise<JournalPlan> {
    const readable: JournalPosition[] = [];
    const fenced: JournalPosition[] = [];
    const beyond: JournalPosition[] = [];
    let missing: JournalPosition | undefined;

    for (const epoch of await this.epochsFrom(from.epoch, lease)) {
      // An epoch newer than the lease's was never opened to write under, so
      // anything in it is fenced as a sealed epoch's excess is.
      const seal = epoch > lease.epoch ? 0 : sealOf(lease, epoch);
      let expected = epoch === from.epoch ? from.sequence + 1 : 1;
      for (const sequence of await this.sequencesIn(epoch)) {
        if (sequence < expected && missing === undefined) continue;
        const position = { epoch, sequence };
        if (missing !== undefined) beyond.push(position);
        else if (seal !== undefined && sequence > seal) fenced.push(position);
        else if (sequence === expected) {
          readable.push(position);
          expected += 1;
        } else {
          missing = { epoch, sequence: expected };
          beyond.push(position);
        }
      }
      if (missing === undefined && seal !== undefined && expected <= seal) {
        missing = { epoch, sequence: expected };
      }
    }
    return new JournalPlan(readable, fenced, missing, beyond);
  }

  /**
   * Removes the records a checkpoint at `head` includes, and sets aside the
   * records of a sealed epoch past its seal, which no checkpoint includes.
   */
  async prune(head: JournalPosition, lease: LeaseRecord): Promise<void> {
    for (const epoch of await this.epochsFrom(0, lease)) {
      if (epoch > head.epoch) continue;
      const earlier = epoch < head.epoch;
      // An earlier epoch without a seal was never replayed past by the
      // checkpoint's writer, so none of its records counts.
      const sealed = sealOf(lease, epoch) ?? (earlier ? 0 : undefined);
      for (const sequence of await this.sequencesIn(epoch)) {
        if (sealed !== undefined && sequence > sealed) {
          await this.setAside({ epoch, sequence });
        } else if (earlier || sequence <= head.sequence) {
          await this.records.tree.remove(this.paths.record(epoch, sequence));
        }
      }
      if (earlier) await this.records.tree.remove(this.paths.epoch(epoch));
    }
  }

  /** Moves a record into the quarantine, where nothing reads it as the journal. */
  async setAside(position: JournalPosition): Promise<void> {
    const from = this.paths.record(position.epoch, position.sequence);
    const bytes = await this.records.tree.readFile(from);
    if (bytes === undefined) return;
    await this.records.tree.writeFile(
      this.paths.quarantined(position.epoch, position.sequence),
      bytes,
    );
    await this.records.tree.remove(from);
  }

  /** The epochs from `first` that hold records or are sealed, in order. */
  private async epochsFrom(first: number, lease: LeaseRecord): Promise<readonly number[]> {
    const epochs = new Set<number>();
    for (const entry of await this.records.tree.list(this.paths.journal)) {
      const epoch = entry.kind === 'directory' ? epochOfDirectory(entry.name) : undefined;
      if (epoch !== undefined && epoch >= first) epochs.add(epoch);
    }
    for (const seal of lease.seals) if (seal.epoch >= first) epochs.add(seal.epoch);
    return [...epochs].sort((left, right) => left - right);
  }

  private async sequencesIn(epoch: number): Promise<readonly number[]> {
    return (await this.records.tree.list(this.paths.epoch(epoch)))
      .flatMap((entry) => {
        const sequence = entry.kind === 'file' ? sequenceOfRecord(entry.name) : undefined;
        return sequence === undefined ? [] : [sequence];
      })
      .sort((left, right) => left - right);
  }
}
