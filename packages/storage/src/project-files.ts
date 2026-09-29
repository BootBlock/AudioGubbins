/**
 * The files of one project and the stores over them, made once for as long as
 * the project is worked with, so every part that reads or writes the project
 * shares one tree, one digest and one set of paths (ADR-0020, REQ-STOR-101).
 */

import type { ProjectId } from '@audiogubbins/domain';

import { type CheckedReading, type CheckedRecords, RecordKind } from './checked-records.js';
import { readCheckpoint, writeCheckpoint, type Checkpoint } from './checkpoint-record.js';
import { CommandJournal } from './command-journal.js';
import type { PairFiles } from './generational-pair.js';
import { headFiles, type ProjectHead } from './project-heads.js';
import { headerFiles, type ProjectHeader } from './project-header.js';
import { SnapshotStore } from './state-store.js';
import { type CheckpointId, ProjectPaths } from './storage-layout.js';

/** One project's files. */
export class ProjectFiles {
  readonly project: ProjectId;
  readonly records: CheckedRecords;
  readonly paths: ProjectPaths;
  readonly states: SnapshotStore;
  readonly journal: CommandJournal;
  readonly heads: PairFiles<ProjectHead>;
  readonly header: PairFiles<ProjectHeader>;

  constructor(records: CheckedRecords, project: ProjectId) {
    this.project = project;
    this.records = records;
    this.paths = new ProjectPaths(project);
    this.states = new SnapshotStore(records.tree, records.digest, project);
    this.journal = new CommandJournal(records, project);
    this.heads = headFiles(this.paths);
    this.header = headerFiles(this.paths);
  }

  async readCheckpoint(
    id: CheckpointId,
    signal?: AbortSignal,
  ): Promise<CheckedReading<Checkpoint>> {
    return await this.records.read(
      this.paths.checkpoint(id),
      RecordKind.Checkpoint,
      readCheckpoint,
      signal,
    );
  }

  async writeCheckpoint(
    id: CheckpointId,
    checkpoint: Checkpoint,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.records.write(
      this.paths.checkpoint(id),
      RecordKind.Checkpoint,
      writeCheckpoint(checkpoint),
      signal,
    );
  }
}
