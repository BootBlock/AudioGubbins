/**
 * A project's backup generations, apart from its history and its recovery
 * files: each a copy of a checkpoint of the project and of every state it
 * keeps, kept under `backups/<project>/<generation>/` (REQ-STOR-105,
 * REQ-STOR-101, REQ-STOR-102).
 *
 * A generation is made from a copy of the project read from storage, so it
 * holds every change written and needs nothing of an open session. Its states
 * go first, then its checkpoint with the segments of history it names, which
 * the generation holds itself so it outlasts the project's own, then the record
 * that says what it is, which is what makes it a generation: a crash before the
 * record leaves an incomplete generation, listed as such and removed by
 * pruning, and never read as a backup. A generation is the whole project or
 * none: a state the project keeps that cannot be read fails it as a refused
 * write does, naming the state and the snapshot that keeps it, rather than
 * leaving the state out and calling what remains a backup. While a generation
 * is written the storage-wide lock is shared (`storage-sharing.ts`), so no
 * pruning takes one being written for one a crash left incomplete. Media is not
 * copied: a generation names it by content, and the storage counts every
 * generation among the roots nothing is purged from while it lasts. A
 * generation is protected by a marker beside it, whose presence alone counts,
 * so protecting and unprotecting never rewrite the generation. Only the window
 * holding the project's write lease makes, protects or removes its generations.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  unsafeBrandId,
  type DomainResult,
  type ProjectId,
} from '@audiogubbins/domain';
import { retainedStates, withStateFingerprint, type History } from '@audiogubbins/history';
import {
  objectOf,
  oneOfConverter,
  pathOf,
  required,
  type Converter,
  type Digest,
  type ProjectState,
  type StateFingerprint,
  type StorageTree,
  type Turns,
} from '@audiogubbins/project-format';

import type { BackupGeneration, BackupReason } from './backup-planning.js';
import { CheckedRecords, RecordKind } from './checked-records.js';
import { CheckpointFiles } from './checkpoint-files.js';
import type { Checkpoint } from './checkpoint-record.js';
import type { ProjectCopy } from './project-copy.js';
import { asWholeNumber } from './record-values.js';
import { SegmentLedger } from './segment-ledger.js';
import { SnapshotStore } from './state-store.js';
import { keptStateUnreadable, refusalsReported } from './storage-failures.js';
import { BackupPaths, numberOfGeneration } from './storage-layout.js';
import { whileWriting } from './storage-sharing.js';
import type { LeaseCoordinator } from './write-lease.js';

/** What a project's generations are, whole and not. */
export interface GenerationListing {
  /** The whole generations, newest first. */
  readonly generations: readonly BackupGeneration[];

  /** The numbers of generations a crash left without their record. */
  readonly incomplete: readonly number[];
}

/** The states a generation keeps, written, and the history naming its cursor's. */
interface KeptStates {
  readonly kept: ReadonlySet<StateFingerprint>;
  readonly bytes: number;
  readonly cursorState: StateFingerprint;
  readonly history: History;
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

  /**
   * Makes a generation of a copy of the project, protected where asked, its
   * history's segments planned a step of `turns` for each node, sharing the
   * storage-wide lock of `coordinator` while it is written.
   */
  async create(
    copy: ProjectCopy,
    made: { readonly reason: BackupReason; readonly at: number; readonly protect: boolean },
    turns: Turns,
    coordinator: LeaseCoordinator | undefined,
  ): Promise<DomainResult<BackupGeneration>> {
    return await whileWriting(
      coordinator,
      async () => await this.written(copy, made, turns),
      turns.signal,
    );
  }

  /** Writes a generation (see {@link create}). */
  private async written(
    copy: ProjectCopy,
    made: { readonly reason: BackupReason; readonly at: number; readonly protect: boolean },
    turns: Turns,
  ): Promise<DomainResult<BackupGeneration>> {
    const { signal } = turns;
    return await refusalsReported(async () => {
      const number = Math.max(0, ...(await this.numbers())) + 1;
      const states = await this.writeStates(copy, number, signal);
      if (!states.ok) return states;
      const { model } = copy;
      const checkpoint: Checkpoint = {
        history: states.value.history,
        cursorState: states.value.cursorState,
        keptStates: states.value.kept,
        exports: model.exports,
        retention: model.retention,
        backup: model.backup,
        ...(model.comparison === undefined ? {} : { comparison: model.comparison }),
        leaseEpoch: 0,
      };
      // A generation is written once, so its segments are simply numbered.
      let segments = 0;
      const written = await this.checkpoints(number).write(
        this.paths.checkpoint(number),
        checkpoint,
        {
          ledger: new SegmentLedger(),
          next: () => unsafeBrandId(String((segments += 1)).padStart(8, '0')),
        },
        turns,
      );
      if (!written.ok) return written;
      let bytes = states.value.bytes;
      for (const path of [
        this.paths.checkpoint(number),
        ...written.value.named.map((segment) => this.paths.segment(number, segment)),
      ]) {
        bytes += (await this.tree.openFile(path))?.size ?? 0;
      }
      if (made.protect) await this.tree.writeFile(this.paths.protection(number), new Uint8Array(0));
      const record: GenerationRecord = { at: made.at, reason: made.reason, bytes };
      const listed = await this.records.write(
        this.paths.record(number),
        RecordKind.BackupGeneration,
        { ...record },
        signal,
      );
      if (!listed.ok) return listed;
      return succeed({ number, ...record, protected: made.protect });
    });
  }

  /**
   * Writes the states generation `number` keeps: each its history keeps, and
   * the state at its cursor, which its history then names. One storage does
   * not hold, or holds damaged, fails the generation (see the module comment).
   */
  private async writeStates(
    copy: ProjectCopy,
    number: number,
    signal?: AbortSignal,
  ): Promise<DomainResult<KeptStates>> {
    const states = new SnapshotStore(this.tree, this.records.digest, this.paths.states(number));
    const kept = new Set<StateFingerprint>();
    let bytes = 0;
    const put = async (state: ProjectState): Promise<DomainResult<StateFingerprint>> => {
      const written = await states.put(state, signal);
      if (!written.ok) return written;
      kept.add(written.value);
      bytes += (await this.tree.openFile(states.path(written.value)))?.size ?? 0;
      return written;
    };
    for (const fingerprint of retainedStates(copy.model.history)) {
      const state = copy.states.isKept(fingerprint)
        ? await copy.states.load(fingerprint, signal)
        : undefined;
      if (!state?.ok) {
        const snapshot = [...copy.model.history.snapshots.values()].find(
          (one) => one.stateFingerprint === fingerprint,
        );
        const unreadable = keptStateUnreadable(
          copy.project,
          fingerprint,
          snapshot,
          state?.failures[0],
        );
        return fail(unreadable);
      }
      const written = await put(state.value);
      if (!written.ok) return written;
    }
    const { model } = copy;
    const cursorState = await put(model.state);
    if (!cursorState.ok) return cursorState;
    const history = withStateFingerprint(model.history, model.history.cursor, cursorState.value);
    if (!history.ok) return history;
    return succeed({ kept, bytes, cursorState: cursorState.value, history: history.value });
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
          ? await this.checkpoints(number).read(this.paths.checkpoint(number), signal)
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

  /** The checkpoint of generation `number` and its segments. */
  private checkpoints(number: number): CheckpointFiles {
    return new CheckpointFiles(this.records, (segment) => this.paths.segment(number, segment));
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
