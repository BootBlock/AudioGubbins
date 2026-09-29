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
 * stale marker, which counts for nothing beside a header.
 */

import { mapResult, type DomainResult, type IdGenerator } from '@audiogubbins/domain';
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
} from '@audiogubbins/project-format';

import { readPair, writeNext, type Slotted } from './generational-pair.js';
import { comparisonFrom } from './comparison-record.js';
import { JOURNAL_START } from './journal-position.js';
import type { ProjectFiles } from './project-files.js';
import { writeHead } from './project-heads.js';
import { writeHeader, type ImportOrigin, type ProjectHeader } from './project-header.js';

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
  readonly history: History;

  /** The states the history keeps whole, besides the cursor's. */
  readonly kept: ReadonlyMap<StateFingerprint, ProjectState>;
  readonly exports: readonly ExportRecord[];
  readonly retention: RetentionPolicy;
  readonly backup: BackupPolicy;

  /** The A/B comparison open, where the project had one. */
  readonly comparison?: ComparisonChoiceRecord;

  /** When the project was made, in milliseconds since the epoch. */
  readonly created: number;
  readonly imported?: ImportOrigin;
}

/**
 * Writes a new project's files, the project being the state's own, and gives
 * its header. Rejects with the tree's refusal where storage refuses a write.
 */
export async function writeNewProject(
  files: ProjectFiles,
  beginning: ProjectBeginning,
  ids: IdGenerator,
  signal?: AbortSignal,
): Promise<DomainResult<ProjectHeader>> {
  const { state, origin, at } = beginning;
  const history = startHistory(state.project.id, {
    kind: 'origin',
    id: ids.next<'HistoryNodeId'>(),
    at,
    origin,
    stateFingerprint: await files.states.fingerprint(state),
  });
  return await writeProject(
    files,
    {
      state,
      history,
      kept: new Map(),
      exports: [],
      retention: DEFAULT_RETENTION_POLICY,
      backup: DEFAULT_BACKUP_POLICY,
      created: at,
    },
    ids,
    signal,
  );
}

/**
 * Writes a project's files from everything it holds, and gives its header.
 * Rejects with the tree's refusal where storage refuses a write.
 */
export async function writeProject(
  files: ProjectFiles,
  contents: ProjectContents,
  ids: IdGenerator,
  signal?: AbortSignal,
): Promise<DomainResult<ProjectHeader>> {
  const { state } = contents;
  const tree = files.records.tree;
  await tree.writeFile(files.paths.unfinished, new Uint8Array(0), signal);
  for (const kept of contents.kept.values()) await files.states.put(kept, signal);
  const cursorState = await files.states.put(state, signal);
  const history = withStateFingerprint(contents.history, contents.history.cursor, cursorState);
  if (!history.ok) return history;
  const comparison =
    contents.comparison === undefined
      ? undefined
      : comparisonFrom(history.value, contents.comparison);
  if (comparison?.ok === false) return comparison;

  const checkpoint = ids.next<'CheckpointId'>();
  await files.writeCheckpoint(
    checkpoint,
    {
      history: history.value,
      cursorState,
      keptStates: new Set([cursorState, ...contents.kept.keys()]),
      exports: contents.exports,
      retention: contents.retention,
      backup: contents.backup,
      ...(comparison === undefined ? {} : { comparison: comparison.value }),
      leaseEpoch: JOURNAL_START.epoch,
    },
    signal,
  );

  const head = await writeHead(
    files.records,
    files.paths,
    { epoch: JOURNAL_START.epoch, checkpoint, journal: JOURNAL_START },
    signal,
  );
  if (!head.ok) return head;

  const header = await writeFirstHeader(files, contents, signal);
  if (header.ok) await tree.remove(files.paths.unfinished);
  return mapResult(header, (written) => written.value);
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
