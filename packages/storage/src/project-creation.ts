/**
 * Writing a project that did not exist: its states, a history, a checkpoint, a
 * head and a header (REQ-STOR-021, REQ-STOR-193, REQ-STOR-199, REQ-STOR-103).
 *
 * Every project begins here, whatever its origin: a new one, whose history is
 * its origin alone; a fork of another's state; or a project brought in from a
 * bundle or an unpacked tree with the history it had. The files are written in
 * the order a crash cannot hurt. A marker saying the project is unfinished is
 * written first, then the states, the checkpoint that keeps them, the head that
 * names the checkpoint and the header, which is what makes the project appear
 * in the list, and the marker is removed last. A directory with the marker and
 * no header that can be read is unfinished: the list passes over it, and
 * cleanup may remove it. A crash after the header leaves a whole project with a
 * stale marker, which counts for nothing beside a header. The states a project
 * keeps are read one at a time as they are written, so a long history brought
 * in or restored is never held whole (REQ-EXEC-216). While the files are
 * written the storage-wide lock is shared (`storage-sharing.ts`), so no cleanup
 * takes a project being made for one a crash left unfinished.
 */

import {
  mapResult,
  succeed,
  type DomainResult,
  type IdGenerator,
  type ProjectId,
} from '@audiogubbins/domain';
import { startHistory, withStateFingerprint, type History } from '@audiogubbins/history';
import {
  DEFAULT_BACKUP_POLICY,
  DEFAULT_RETENTION_POLICY,
  type BackupPolicy,
  type ComparisonChoiceRecord,
  type ExportRecord,
  type ProjectOrigin,
  type ProjectState,
  type RetentionPolicy,
  type StateFingerprint,
  type TreeStates,
  type Turns,
} from '@audiogubbins/project-format';

import { readPair, writeNext, type Slotted } from './generational-pair.js';
import { comparisonFrom } from './comparison-record.js';
import { JOURNAL_START } from './journal-position.js';
import type { ProjectFiles } from './project-files.js';
import { writeHead } from './project-heads.js';
import { writeHeader, type ImportOrigin, type ProjectHeader } from './project-header.js';
import { SegmentLedger } from './segment-ledger.js';
import type { CheckpointId } from './storage-layout.js';
import { whileWriting } from './storage-sharing.js';
import type { LeaseCoordinator } from './write-lease.js';

/** What writing a project's files works with. */
export interface ProjectWriting {
  readonly ids: IdGenerator;
  readonly turns: Turns;

  /** The platform's lease coordination, whose storage-wide lock is shared while writing. */
  readonly coordinator: LeaseCoordinator | undefined;
}

/** What a new project begins as. */
export interface ProjectBeginning {
  readonly state: ProjectState;
  readonly origin: ProjectOrigin;

  /** When it begins, in milliseconds since the epoch. */
  readonly at: number;
}

/** Everything a project is written with, the project being the state's own. */
export interface ProjectContents {
  /** The state at the history's cursor. */
  readonly state: ProjectState;

  /**
   * The history, once its kept states are written: `renamed` gives what each
   * was listed by and what it was kept under, which differ only where a state
   * was changed as it was read, as a copy's are under its new identity.
   */
  readonly history: (
    renamed: ReadonlyMap<StateFingerprint, StateFingerprint>,
  ) => DomainResult<History>;

  /**
   * The states the history keeps whole, besides the cursor's, each read as it
   * is written and kept under the fingerprint it has then.
   */
  readonly kept: TreeStates;
  readonly exports: readonly ExportRecord[];
  readonly retention: RetentionPolicy;
  readonly backup: BackupPolicy;

  /** The A/B comparison open, where the project had one. */
  readonly comparison?: ComparisonChoiceRecord;

  /** When the project was made, in milliseconds since the epoch. */
  readonly created: number;
  readonly imported?: ImportOrigin;
}

/** A project that keeps no state besides the cursor's. */
const NO_KEPT_STATES: TreeStates = {
  fingerprints: [],
  load: () => Promise.reject(new Error('A project that keeps no state was asked for one.')),
};

/**
 * The history of a project that begins here rather than carrying one in: a
 * single origin node naming the state it begins with, no state kept besides
 * the cursor's, and the retention every such project begins with. A project
 * made, forked or brought in without its history begins alike.
 */
export function begunHistory(
  beginning: Omit<ProjectBeginning, 'state'> & {
    readonly project: ProjectId;
    readonly stateFingerprint: StateFingerprint;
  },
  ids: IdGenerator,
): Pick<ProjectContents, 'history' | 'kept' | 'retention'> {
  const history = startHistory(beginning.project, {
    kind: 'origin',
    id: ids.next<'HistoryNodeId'>(),
    at: beginning.at,
    origin: beginning.origin,
    stateFingerprint: beginning.stateFingerprint,
  });
  return {
    history: () => succeed(history),
    kept: NO_KEPT_STATES,
    retention: DEFAULT_RETENTION_POLICY,
  };
}

/**
 * Writes a new project's files, the project being the state's own, and gives
 * its header. Rejects with the tree's refusal where storage refuses a write.
 */
export async function writeNewProject(
  files: ProjectFiles,
  beginning: ProjectBeginning,
  writing: ProjectWriting,
): Promise<DomainResult<ProjectHeader>> {
  const { state, origin, at } = beginning;
  const begun = begunHistory(
    {
      project: state.project.id,
      origin,
      at,
      stateFingerprint: await files.states.fingerprint(state),
    },
    writing.ids,
  );
  return await writeProject(
    files,
    { state, ...begun, exports: [], backup: DEFAULT_BACKUP_POLICY, created: at },
    writing,
  );
}

/**
 * Writes a project's files from everything it holds, and gives its header.
 * Rejects with the tree's refusal where storage refuses a write.
 */
export async function writeProject(
  files: ProjectFiles,
  contents: ProjectContents,
  writing: ProjectWriting,
): Promise<DomainResult<ProjectHeader>> {
  const { ids, turns, coordinator } = writing;
  const tree = files.records.tree;
  const { signal } = turns;
  return await whileWriting(
    coordinator,
    async () => {
      await tree.writeFile(files.paths.unfinished, new Uint8Array(0), signal);
      const checkpoint = await writeFirstCheckpoint(files, contents, ids, turns);
      if (!checkpoint.ok) return checkpoint;

      const head = await writeHead(
        files.records,
        files.paths,
        { epoch: JOURNAL_START.epoch, checkpoint: checkpoint.value, journal: JOURNAL_START },
        signal,
      );
      if (!head.ok) return head;

      const header = await writeFirstHeader(files, contents, signal);
      if (header.ok) await tree.remove(files.paths.unfinished);
      return mapResult(header, (written) => written.value);
    },
    signal,
  );
}

/**
 * Writes the states `kept` lists, each read only as it is written, and gives
 * what each it wrote was listed by and kept under; one that cannot be read and
 * may be left out is left out.
 */
async function writeKept(
  files: ProjectFiles,
  kept: TreeStates,
  turns: Turns,
): Promise<DomainResult<ReadonlyMap<StateFingerprint, StateFingerprint>>> {
  const { signal } = turns;
  const written = new Map<StateFingerprint, StateFingerprint>();
  for (const fingerprint of kept.fingerprints) {
    await turns.afterHeavyStep();
    const state = await kept.load(fingerprint, signal);
    if (!state.ok) return state;
    if (state.value === undefined) continue;
    const put = await files.states.put(state.value, signal);
    if (!put.ok) return put;
    written.set(fingerprint, put.value);
  }
  return succeed(written);
}

/** Writes the states a new project keeps and its first checkpoint, and gives the checkpoint. */
async function writeFirstCheckpoint(
  files: ProjectFiles,
  contents: ProjectContents,
  ids: IdGenerator,
  turns: Turns,
): Promise<DomainResult<CheckpointId>> {
  const { signal } = turns;
  const kept = await writeKept(files, contents.kept, turns);
  if (!kept.ok) return kept;
  const cursorState = await files.states.put(contents.state, signal);
  if (!cursorState.ok) return cursorState;
  const named = contents.history(kept.value);
  if (!named.ok) return named;
  const history = withStateFingerprint(named.value, named.value.cursor, cursorState.value);
  if (!history.ok) return history;
  const comparison =
    contents.comparison === undefined
      ? undefined
      : comparisonFrom(history.value, contents.comparison);
  if (comparison?.ok === false) return comparison;

  const checkpoint = ids.next<'CheckpointId'>();
  const written = await files.writeCheckpoint(
    checkpoint,
    {
      history: history.value,
      cursorState: cursorState.value,
      keptStates: new Set([cursorState.value, ...kept.value.values()]),
      exports: contents.exports,
      retention: contents.retention,
      backup: contents.backup,
      ...(comparison === undefined ? {} : { comparison: comparison.value }),
      leaseEpoch: JOURNAL_START.epoch,
    },
    new SegmentLedger(),
    ids,
    turns,
  );
  return mapResult(written, () => checkpoint);
}

/** The header that makes a project appear in the list, written once all else is whole. */
async function writeFirstHeader(
  files: ProjectFiles,
  contents: ProjectContents,
  signal?: AbortSignal,
): Promise<DomainResult<Slotted<ProjectHeader>>> {
  return await writeNext(
    files.records,
    files.header,
    await readPair(files.records, files.header, signal),
    (generation) =>
      writeHeader({
        generation,
        id: contents.state.project.id,
        name: contents.state.project.displayName,
        created: contents.created,
        ...(contents.imported === undefined ? {} : { imported: contents.imported }),
      }),
    signal,
  );
}
