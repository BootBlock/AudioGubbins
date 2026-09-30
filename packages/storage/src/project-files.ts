/**
 * The files of one project and the stores over them, made once for as long as
 * the project is worked with, so every part that reads or writes the project
 * shares one tree, one digest and one set of paths (ADR-0020, REQ-STOR-101).
 */

import type { DomainResult, ProjectId } from '@audiogubbins/domain';

import { type CheckedReading, type CheckedRecords, RecordKind } from './checked-records.js';
import { readCheckpoint, writeCheckpoint, type Checkpoint } from './checkpoint-record.js';
import { CommandJournal } from './command-journal.js';
import type { PairFiles } from './generational-pair.js';
import { headerFiles, type ProjectHeader } from './project-header.js';
import { newestHead } from './project-heads.js';
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

  constructor(records: CheckedRecords, project: ProjectId) {
    this.project = project;
    this.records = records;
    this.paths = new ProjectPaths(project);
    this.states = new SnapshotStore(records.tree, records.digest, this.paths.states);
    this.journal = new CommandJournal(records, project);
    this.header = headerFiles(this.paths);
  }

  /** The checkpoint the newest head names, where it can be read. */
  async newestCheckpoint(signal?: AbortSignal): Promise<Checkpoint | undefined> {
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
  ): Promise<CheckedReading<Checkpoint>> {
    return await this.records.read(
      this.paths.checkpoint(epoch, id),
      RecordKind.Checkpoint,
      readCheckpoint,
      signal,
    );
  }

  /**
   * Writes a checkpoint under the lease epoch it records, failing as
   * {@link CheckedRecords.write} does.
   */
  async writeCheckpoint(
    id: CheckpointId,
    checkpoint: Checkpoint,
    signal?: AbortSignal,
  ): Promise<DomainResult<void>> {
    return await this.records.write(
      this.paths.checkpoint(checkpoint.leaseEpoch, id),
      RecordKind.Checkpoint,
      writeCheckpoint(checkpoint),
      signal,
    );
  }
}
