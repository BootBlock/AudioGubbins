/**
 * Writing a project that did not exist: its first state, a history of its
 * origin alone, a checkpoint, a head and a header (REQ-STOR-021, REQ-STOR-193,
 * REQ-STOR-199).
 *
 * The files are written in the order a crash cannot hurt: the state, the
 * checkpoint that keeps it, the head that names the checkpoint, and the header
 * last, since the header is what makes the project appear in the list. A crash
 * before the header leaves a directory the list reports as unreadable rather
 * than a project that cannot be opened. Every project begins here, whatever its
 * origin: a new one, an import, or a fork of another's state.
 */

import { mapResult, type DomainResult, type IdGenerator } from '@audiogubbins/domain';
import { startHistory } from '@audiogubbins/history';
import {
  DEFAULT_RETENTION_POLICY,
  type ProjectOrigin,
  type ProjectState,
} from '@audiogubbins/project-format';

import { DEFAULT_BACKUP_POLICY } from './backup-policy.js';
import { readPair, writeNext } from './generational-pair.js';
import { JOURNAL_START } from './journal-position.js';
import type { ProjectFiles } from './project-files.js';
import { writeHead } from './project-heads.js';
import { writeHeader, type ProjectHeader } from './project-header.js';

/** What a new project begins as. */
export interface ProjectBeginning {
  readonly state: ProjectState;
  readonly origin: ProjectOrigin;

  /** When it begins, in milliseconds since the epoch. */
  readonly at: number;
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
  const stateFingerprint = await files.states.put(state, signal);
  const history = startHistory(state.project.id, {
    kind: 'origin',
    id: ids.next<'HistoryNodeId'>(),
    at,
    origin,
    stateFingerprint,
  });

  const checkpoint = ids.next<'CheckpointId'>();
  await files.writeCheckpoint(
    checkpoint,
    {
      history,
      cursorState: stateFingerprint,
      keptStates: new Set([stateFingerprint]),
      exports: [],
      retention: DEFAULT_RETENTION_POLICY,
      backup: DEFAULT_BACKUP_POLICY,
      leaseEpoch: JOURNAL_START.epoch,
    },
    signal,
  );

  const head = await writeNext(
    files.records,
    files.heads,
    await readPair(files.records, files.heads, signal),
    (generation) => writeHead({ generation, checkpoint, journal: JOURNAL_START }),
    signal,
  );
  if (!head.ok) return head;

  const header = await writeNext(
    files.records,
    files.header,
    await readPair(files.records, files.header, signal),
    (generation) =>
      writeHeader({
        generation,
        id: state.project.id,
        name: state.project.displayName,
        created: at,
      }),
    signal,
  );
  return mapResult(header, (written) => written.value);
}
