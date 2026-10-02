/**
 * A project's commit points: the heads, each naming the checkpoint the project
 * is at and the position in the journal that checkpoint includes (ADR-0020,
 * REQ-STOR-098, REQ-STOR-101).
 *
 * A checkpoint counts only once a head names it, and a head is written only
 * after its checkpoint and every state the checkpoint keeps, so a head never
 * names what is not yet whole. Each head is a file of its own, written once and
 * never again, named by the lease epoch it was written under and its generation
 * within that epoch, and it counts only once it reads back valid. So no writer
 * can overwrite another's head: a writer that lost the project late writes only
 * a head of its own epoch, which the lease's seal fences where it goes past
 * what the new writer read, and which ranks below every head of a later epoch.
 * Recovery tries the heads newest first, by epoch and then by generation, and
 * falls back to the next where one does not serve.
 */

import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';
import {
  objectOf,
  pathOf,
  required,
  type Converter,
  type JsonObject,
} from '@audiogubbins/project-format';

import { RecordKind, type CheckedRecords, type RecordFault } from './checked-records.js';
import { asPosition, writePosition, type JournalPosition } from './journal-position.js';
import { asCheckpointId, asCountingNumber, asWholeNumber } from './record-values.js';
import { headOfName, type CheckpointId, type ProjectPaths } from './storage-layout.js';

/** A project's head. */
export interface ProjectHead {
  /** The lease epoch it was written under, which its checkpoint was written under too. */
  readonly epoch: number;

  /** Its place among the heads of its epoch, counting from 1. */
  readonly generation: number;
  readonly checkpoint: CheckpointId;

  /** The last journal record the checkpoint includes. */
  readonly journal: JournalPosition;
}

/** What reading a project's heads found. */
export interface HeadReading {
  /** The valid heads, the newest first. */
  readonly valid: readonly ProjectHead[];

  /** Each head file that holds something other than a valid head, and why. */
  readonly faults: readonly { readonly path: string; readonly fault: RecordFault }[];
}

const HEAD_MEMBERS: ReadonlySet<string> = new Set(['epoch', 'generation', 'checkpoint', 'journal']);

function writeHeadRecord(head: ProjectHead): JsonObject {
  return {
    epoch: head.epoch,
    generation: head.generation,
    checkpoint: head.checkpoint,
    journal: writePosition(head.journal),
  };
}

const readHead: Converter<ProjectHead> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, HEAD_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const epoch = required(reading, object, at, 'epoch', asWholeNumber);
  const generation = required(reading, object, at, 'generation', asCountingNumber);
  const checkpoint = required(reading, object, at, 'checkpoint', asCheckpointId);
  const journal = required(reading, object, at, 'journal', asPosition);
  if (
    epoch === undefined ||
    generation === undefined ||
    checkpoint === undefined ||
    journal === undefined
  ) {
    return undefined;
  }
  return { epoch, generation, checkpoint, journal };
};

/** The fault of a head whose content names another epoch or generation than its file. */
const MISNAMED = failure(
  'storage.head-misnamed',
  FailureKind.IntegrityViolation,
  'A head is not the one its name says.',
);

/** Orders heads newest first: by epoch, then by generation. */
function newestFirst(left: ProjectHead, right: ProjectHead): number {
  return right.epoch - left.epoch || right.generation - left.generation;
}

/** Reads every head of a project. A head whose name and content disagree is a fault. */
export async function readHeads(
  records: CheckedRecords,
  paths: ProjectPaths,
  signal?: AbortSignal,
): Promise<HeadReading> {
  const valid: ProjectHead[] = [];
  const faults: { path: string; fault: RecordFault }[] = [];
  for (const entry of await records.tree.list(paths.heads)) {
    const named = entry.kind === 'file' ? headOfName(entry.name) : undefined;
    if (named === undefined) continue;
    const path = paths.head(named.epoch, named.generation);
    const read = await records.read(path, RecordKind.ProjectHead, readHead, signal);
    if (read.kind === 'invalid') faults.push({ path, fault: read.fault });
    else if (
      read.kind === 'valid' &&
      read.value.epoch === named.epoch &&
      read.value.generation === named.generation
    ) {
      valid.push(read.value);
    } else if (read.kind === 'valid') {
      faults.push({ path, fault: { kind: 'malformed', failures: [MISNAMED] } });
    }
  }
  valid.sort(newestFirst);
  return { valid, faults };
}

/** Whether two heads are the same commit point, or both absent. */
export function sameHead(
  one: Pick<ProjectHead, 'epoch' | 'generation'> | undefined,
  other: Pick<ProjectHead, 'epoch' | 'generation'> | undefined,
): boolean {
  return one?.epoch === other?.epoch && one?.generation === other?.generation;
}

/** The newest valid head of a project, where it has one. */
export async function newestHead(
  records: CheckedRecords,
  paths: ProjectPaths,
  signal?: AbortSignal,
): Promise<ProjectHead | undefined> {
  return (await readHeads(records, paths, signal)).valid[0];
}

/**
 * Writes the next head of the writer's epoch, after every head of that epoch
 * already written, and confirms it by reading it back.
 */
export async function writeHead(
  records: CheckedRecords,
  paths: ProjectPaths,
  head: Omit<ProjectHead, 'generation'>,
  signal?: AbortSignal,
): Promise<DomainResult<ProjectHead>> {
  const ofEpoch = (await readHeads(records, paths, signal)).valid.filter(
    (written) => written.epoch === head.epoch,
  );
  const generation = (ofEpoch[0]?.generation ?? 0) + 1;
  const path = paths.head(head.epoch, generation);
  const record: ProjectHead = { ...head, generation };
  const written = await records.write(
    path,
    RecordKind.ProjectHead,
    writeHeadRecord(record),
    signal,
  );
  if (!written.ok) return written;
  const back = await records.read(path, RecordKind.ProjectHead, readHead, signal);
  if (back.kind !== 'valid' || back.value.generation !== generation) {
    return fail(
      failure(
        'storage.write-not-confirmed',
        FailureKind.Retryable,
        'A record written could not be read back as written, so it does not count.',
        { details: { generation } },
      ),
    );
  }
  return succeed(back.value);
}
