/**
 * The epochs of a project's write lease and their seals, which fence a writer
 * that has lost the project from changing it (REQ-STOR-098, ADR-0020).
 *
 * Every writer that opens a project raises the epoch, writes its journal under
 * the new one, and seals each earlier epoch at its last valid record. A record
 * of a sealed epoch past its seal, such as a write the previous owner had in
 * flight when the project was taken from it, is therefore never replayed.
 *
 * Each epoch's record is its own file, written once, and counts only once it
 * reads back valid, so no rewrite in place can tear what the fencing rests on:
 * the newest valid record is current, and a newer one that is torn was never
 * written under, since nothing is journalled under an epoch before its record
 * is confirmed.
 */

import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';
import {
  listConverter,
  objectOf,
  pathOf,
  required,
  type Converter,
  type JsonObject,
} from '@audiogubbins/project-format';

import { RecordKind, type CheckedRecords } from './checked-records.js';
import { asWholeNumber } from './record-values.js';
import { epochOfLease, type ProjectPaths } from './storage-layout.js';

/** Where an earlier epoch ends: its last record that counts. */
export interface EpochSeal {
  readonly epoch: number;
  readonly lastSequence: number;
}

/** The current epoch and the seals of those before it. */
export interface LeaseRecord {
  readonly epoch: number;

  /** One seal for each earlier epoch that may still hold records, by epoch. */
  readonly seals: readonly EpochSeal[];
}

/** What a project's lease records say. */
export interface LeaseReading {
  /** The newest valid record, or epoch 0 and no seals before any writer opened the project. */
  readonly current: LeaseRecord;

  /** The highest epoch any record is named for, valid or not. */
  readonly highestNamed: number;
}

/** The lease of a project no writer has opened. */
const UNOPENED: LeaseRecord = { epoch: 0, seals: [] };

const LEASE_MEMBERS: ReadonlySet<string> = new Set(['epoch', 'seals']);
const SEAL_MEMBERS: ReadonlySet<string> = new Set(['epoch', 'lastSequence']);

/** The most seals one record holds: one for each epoch a checkpoint has not yet passed. */
const MAXIMUM_SEALS = 1_000_000;

/** The sequence an epoch is sealed at, or `undefined` where it is not sealed. */
export function sealOf(lease: LeaseRecord, epoch: number): number | undefined {
  return lease.seals.find((seal) => seal.epoch === epoch)?.lastSequence;
}

/** Reads the newest valid lease record of a project. */
export async function readLease(
  records: CheckedRecords,
  paths: ProjectPaths,
  signal?: AbortSignal,
): Promise<LeaseReading> {
  const epochs = (await records.tree.list(paths.leases))
    .flatMap((entry) => {
      const epoch = entry.kind === 'file' ? epochOfLease(entry.name) : undefined;
      return epoch === undefined ? [] : [epoch];
    })
    .sort((left, right) => right - left);
  const highestNamed = epochs[0] ?? 0;
  for (const epoch of epochs) {
    const read = await records.read(paths.lease(epoch), RecordKind.Lease, readLeaseRecord, signal);
    if (read.kind === 'valid' && read.value.epoch === epoch) {
      return { current: read.value, highestNamed };
    }
  }
  return { current: UNOPENED, highestNamed };
}

/**
 * Raises the epoch past every one named, sealing the earlier epochs as `seals`
 * says, and confirms the record by reading it back.
 */
export async function raiseEpoch(
  records: CheckedRecords,
  paths: ProjectPaths,
  reading: LeaseReading,
  seals: readonly EpochSeal[],
  signal?: AbortSignal,
): Promise<DomainResult<LeaseRecord>> {
  const epoch = Math.max(reading.current.epoch, reading.highestNamed) + 1;
  const record: LeaseRecord = { epoch, seals };
  await records.write(paths.lease(epoch), RecordKind.Lease, writeLeaseRecord(record), signal);
  const back = await records.read(paths.lease(epoch), RecordKind.Lease, readLeaseRecord, signal);
  if (back.kind !== 'valid' || back.value.epoch !== epoch) {
    return fail(
      failure(
        'storage.lease-not-confirmed',
        FailureKind.Retryable,
        'The write lease could not be confirmed in storage, so the project was not opened to write.',
      ),
    );
  }
  return succeed(back.value);
}

function writeLeaseRecord(record: LeaseRecord): JsonObject {
  return {
    epoch: record.epoch,
    seals: [...record.seals]
      .sort((left, right) => left.epoch - right.epoch)
      .map((seal) => ({ epoch: seal.epoch, lastSequence: seal.lastSequence })),
  };
}

const asSeal: Converter<EpochSeal> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, SEAL_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const epoch = required(reading, object, at, 'epoch', asWholeNumber);
  const lastSequence = required(reading, object, at, 'lastSequence', asWholeNumber);
  return epoch === undefined || lastSequence === undefined ? undefined : { epoch, lastSequence };
};

const asSeals = listConverter(MAXIMUM_SEALS, asSeal);

const readLeaseRecord: Converter<LeaseRecord> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, LEASE_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const epoch = required(reading, object, at, 'epoch', asWholeNumber);
  const seals = required(reading, object, at, 'seals', asSeals);
  if (epoch === undefined || seals === undefined) return undefined;
  if (seals.some((seal) => seal.epoch >= epoch)) {
    reading.refuse(
      'lease.seal-not-earlier',
      'A lease seals only earlier epochs.',
      pathOf(at, 'seals'),
    );
    return undefined;
  }
  return { epoch, seals };
};
