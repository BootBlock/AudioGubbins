/**
 * The files of one project and the stores over them, made once for as long as
 * the project is worked with, so every part that reads or writes the project
 * shares one tree, one digest and one set of paths (ADR-0020, REQ-STOR-101).
 */

import type { DomainResult, IdGenerator, ProjectId } from '@audiogubbins/domain';

import type { CheckedReading, CheckedRecords } from './checked-records.js';
import {
  CheckpointFiles,
  type StoredCheckpoint,
  type WrittenSegments,
} from './checkpoint-files.js';
import type { Checkpoint } from './checkpoint-record.js';
import { CommandJournal } from './command-journal.js';
import type { PairFiles } from './generational-pair.js';
import { headerFiles, type ProjectHeader } from './project-header.js';
import { newestHead } from './project-heads.js';
import type { SegmentLedger } from './segment-ledger.js';
import { SnapshotStore } from './state-store.js';
import { type CheckpointId, ProjectPaths } from './storage-layout.js';

/** One project's files. */
export class ProjectFiles {
  readonly project: ProjectId;
  readonly records: CheckedRecords;
  readonly paths: ProjectPaths;
  readonly states: SnapshotStore;
  readonly journal: CommandJournal;
  readonly header: PairFiles<ProjectHeader>;
  private readonly checkpoints: CheckpointFiles;

  constructor(records: CheckedRecords, project: ProjectId) {
    this.project = project;
    this.records = records;
    this.paths = new ProjectPaths(project);
    this.states = new SnapshotStore(records.tree, records.digest, this.paths.states);
    this.journal = new CommandJournal(records, project);
    this.header = headerFiles(this.paths);
    this.checkpoints = new CheckpointFiles(records, (segment) => this.paths.segment(segment));
  }

  /** The checkpoint the newest head names, where it can be read. */
  async newestCheckpoint(signal?: AbortSignal): Promise<StoredCheckpoint | undefined> {
    const head = await newestHead(this.records, this.paths, signal);
    if (head === undefined) return undefined;
    const read = await this.readCheckpoint(head.epoch, head.checkpoint, signal);
    return read.kind === 'valid' ? read.value : undefined;
  }

  /**
   * Whether the project is marked unfinished: being made, or its making cut
   * short. Only where no header can be read does the mark count.
   */
  async isUnfinished(): Promise<boolean> {
    return (await this.records.tree.openFile(this.paths.unfinished)) !== undefined;
  }

  /** The checkpoint of an id, written under a lease epoch. */
  async readCheckpoint(
    epoch: number,
    id: CheckpointId,
    signal?: AbortSignal,
  ): Promise<CheckedReading<StoredCheckpoint>> {
    return await this.checkpoints.read(this.paths.checkpoint(epoch, id), signal);
  }

  /**
   * Writes a checkpoint under the lease epoch it records, and the segments
   * `ledger` plans for it, each named from `ids`, failing as
   * {@link CheckpointFiles.write} does.
   */
  async writeCheckpoint(
    id: CheckpointId,
    checkpoint: Checkpoint,
    ledger: SegmentLedger,
    ids: IdGenerator,
    signal?: AbortSignal,
  ): Promise<DomainResult<WrittenSegments>> {
    return await this.checkpoints.write(
      this.paths.checkpoint(checkpoint.leaseEpoch, id),
      checkpoint,
      { ledger, next: () => ids.next<'HistorySegmentId'>() },
      signal,
    );
  }
}
