/**
 * A project's backup generations, apart from its history and its recovery
 * files: each a copy of a checkpoint of the project and of every state it
 * keeps, kept under `backups/<project>/<generation>/` (REQ-STOR-105,
 * REQ-STOR-101, REQ-STOR-102).
 *
 * A generation is made from a copy of the project read from storage, so it
 * holds every change written and needs nothing of an open session. Its states
 * go first, then its checkpoint, then the record that says what it is, which is
 * what makes it a generation: a crash before the record leaves an incomplete
 * generation, listed as such and removed by pruning, and never read as a
 * backup. Media is not copied: a generation names it by content, and the
 * storage counts every generation among the roots nothing is purged from while
 * it lasts. A generation is protected by a marker beside it, whose presence
 * alone counts, so protecting and unprotecting never rewrite the generation.
 * Only the window holding the project's write lease makes, protects or removes
 * its generations.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainResult,
  type ProjectId,
} from '@audiogubbins/domain';
import { withStateFingerprint } from '@audiogubbins/history';
import {
  objectOf,
  oneOfConverter,
  pathOf,
  required,
  type Converter,
  type Digest,
  type StateFingerprint,
  type StorageTree,
} from '@audiogubbins/project-format';

import type { BackupGeneration, BackupReason } from './backup-planning.js';
import { CheckedRecords, RecordKind } from './checked-records.js';
import { readCheckpoint, writeCheckpoint, type Checkpoint } from './checkpoint-record.js';
import { offeredStates, type ProjectCopy } from './project-copy.js';
import { asWholeNumber } from './record-values.js';
import { SnapshotStore } from './state-store.js';
import { refusalsReported } from './storage-failures.js';
import { BackupPaths, numberOfGeneration } from './storage-layout.js';

/** What a project's generations are, whole and not. */
export interface GenerationListing {
  /** The whole generations, newest first. */
  readonly generations: readonly BackupGeneration[];

  /** The numbers of generations a crash left without their record. */
  readonly incomplete: readonly number[];
}

/** What a generation's record says of it. */
interface GenerationRecord {
  readonly at: number;
  readonly reason: BackupReason;
  readonly bytes: number;
}

const RECORD_MEMBERS: ReadonlySet<string> = new Set(['at', 'reason', 'bytes']);
const asReason = oneOfConverter<BackupReason>(['time', 'save', 'manual']);

const readRecord: Converter<GenerationRecord> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, RECORD_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const time = required(reading, object, at, 'at', asWholeNumber);
  const reason = required(reading, object, at, 'reason', asReason);
  const bytes = required(reading, object, at, 'bytes', asWholeNumber);
  return time === undefined || reason === undefined || bytes === undefined
    ? undefined
    : { at: time, reason, bytes };
};

/** One project's backup generations (see the module comment). */
export class BackupGenerations {
  readonly project: ProjectId;
  private readonly records: CheckedRecords;
  private readonly paths: BackupPaths;

  constructor(tree: StorageTree, digest: Digest, project: ProjectId) {
    this.project = project;
    this.records = new CheckedRecords(tree, digest);
    this.paths = new BackupPaths(project);
  }

  /** Every generation, whole or not. */
  async list(signal?: AbortSignal): Promise<DomainResult<GenerationListing>> {
    return await refusalsReported(async () => {
      const generations: BackupGeneration[] = [];
      const incomplete: number[] = [];
      for (const number of await this.numbers()) {
        signal?.throwIfAborted();
        const record = await this.records.read(
          this.paths.record(number),
          RecordKind.BackupGeneration,
          readRecord,
          signal,
        );
        if (record.kind !== 'valid') {
          incomplete.push(number);
          continue;
        }
        const isProtected = (await this.tree.openFile(this.paths.protection(number))) !== undefined;
        generations.push({ number, ...record.value, protected: isProtected });
      }
      return succeed({ generations: generations.reverse(), incomplete });
    });
  }

  /** Makes a generation of a copy of the project, protected where asked. */
  async create(
    copy: ProjectCopy,
    made: { readonly reason: BackupReason; readonly at: number; readonly protect: boolean },
    signal?: AbortSignal,
  ): Promise<DomainResult<BackupGeneration>> {
    return await refusalsReported(async () => {
      const number = Math.max(0, ...(await this.numbers())) + 1;
      const states = new SnapshotStore(this.tree, this.records.digest, this.paths.states(number));
      const kept = new Set<StateFingerprint>();
      let bytes = 0;
      const keep = async (fingerprint: StateFingerprint): Promise<void> => {
        kept.add(fingerprint);
        bytes += (await this.tree.openFile(states.path(fingerprint)))?.size ?? 0;
      };
      for (const fingerprint of offeredStates(copy)) {
        const state = await copy.states.load(fingerprint, signal);
        if (state.ok) await keep(await states.put(state.value, signal));
      }
      const { model } = copy;
      const cursorState = await states.put(model.state, signal);
      await keep(cursorState);
      const history = withStateFingerprint(model.history, model.history.cursor, cursorState);
      if (!history.ok) return history;

      const checkpoint: Checkpoint = {
        history: history.value,
        cursorState,
        keptStates: kept,
        exports: model.exports,
        retention: model.retention,
        backup: model.backup,
        ...(model.comparison === undefined ? {} : { comparison: model.comparison }),
        leaseEpoch: 0,
      };
      const checkpointBody = writeCheckpoint(checkpoint);
      await this.records.write(
        this.paths.checkpoint(number),
        RecordKind.Checkpoint,
        checkpointBody,
        signal,
      );
      bytes += (await this.tree.openFile(this.paths.checkpoint(number)))?.size ?? 0;
      if (made.protect) await this.tree.writeFile(this.paths.protection(number), new Uint8Array(0));
      const record: GenerationRecord = { at: made.at, reason: made.reason, bytes };
      await this.records.write(this.paths.record(number), RecordKind.BackupGeneration, {
        ...record,
      });
      return succeed({ number, ...record, protected: made.protect });
    });
  }

  /** Protects a generation from pruning, or lets pruning consider it again. */
  async protect(number: number, protect: boolean): Promise<DomainResult<void>> {
    return await refusalsReported(async () => {
      const listed = await this.records.read(
        this.paths.record(number),
        RecordKind.BackupGeneration,
        readRecord,
      );
      if (listed.kind !== 'valid') return fail(generationMissing(this.project, number));
      const marker = this.paths.protection(number);
      if (protect) await this.tree.writeFile(marker, new Uint8Array(0));
      else await this.tree.remove(marker);
      return succeed(undefined);
    });
  }

  /**
   * Removes generations. Their records go first, so one a crash cut short is
   * incomplete, never a generation missing its states.
   */
  async remove(numbers: readonly number[], signal?: AbortSignal): Promise<DomainResult<void>> {
    return await refusalsReported(async () => {
      for (const number of numbers) {
        signal?.throwIfAborted();
        await this.tree.remove(this.paths.record(number));
        await this.tree.remove(this.paths.generation(number));
      }
      return succeed(undefined);
    });
  }

  /** A generation as a copy of the project it was made of, to export or restore. */
  async copyOf(number: number, signal?: AbortSignal): Promise<DomainResult<ProjectCopy>> {
    return await refusalsReported(async () => {
      const record = await this.records.read(
        this.paths.record(number),
        RecordKind.BackupGeneration,
        readRecord,
        signal,
      );
      const checkpoint =
        record.kind === 'valid'
          ? await this.records.read(
              this.paths.checkpoint(number),
              RecordKind.Checkpoint,
              readCheckpoint,
              signal,
            )
          : record;
      if (checkpoint.kind !== 'valid') return fail(generationMissing(this.project, number));
      const saved = checkpoint.value;
      const states = new SnapshotStore(this.tree, this.records.digest, this.paths.states(number));
      const state = await states.get(saved.cursorState, signal);
      if (!state.ok) return state;
      return succeed({
        project: this.project,
        model: {
          state: state.value,
          history: saved.history,
          exports: saved.exports,
          retention: saved.retention,
          backup: saved.backup,
          ...(saved.comparison === undefined ? {} : { comparison: saved.comparison }),
        },
        states: {
          isKept: (fingerprint) => saved.keptStates.has(fingerprint),
          load: async (fingerprint, loadSignal) => await states.get(fingerprint, loadSignal),
        },
      });
    });
  }

  private get tree() {
    return this.records.tree;
  }

  /** The numbers of every generation directory, in order. */
  private async numbers(): Promise<readonly number[]> {
    return (await this.tree.list(this.paths.directory))
      .flatMap((entry) => {
        const number = entry.kind === 'directory' ? numberOfGeneration(entry.name) : undefined;
        return number === undefined ? [] : [number];
      })
      .sort((one, other) => one - other);
  }
}

function generationMissing(project: ProjectId, generation: number) {
  return failure(
    'storage.backup-missing',
    FailureKind.Rejected,
    'There is no such backup generation, or it is not whole.',
    { details: { project, generation } },
  );
}
