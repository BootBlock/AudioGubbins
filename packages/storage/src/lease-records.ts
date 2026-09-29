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
 * is confirmed. Each record names the opening that wrote it, so two openings
 * that raced to one epoch number cannot both take it to be theirs: each checks
 * the record it reads back, and the lease it writes under, by that name.
 *
 * An opening raises the epoch twice. First it claims one before it reads
 * anything of the project, carrying the earlier seals; from then on the writer
 * it replaces finds itself superseded at its next reading of the lease, before
 * it moves a head or removes a file. Only then does it read the project, and
 * then it raises the epoch again, sealing each earlier epoch at the last record
 * it read, and the claimed epoch, under which nothing is written, at none.
 * Claiming first is what lets a writer that lost the project late remove what
 * its own newest head replaced: any opening that has not yet claimed will read
 * that head (`checkpoint-writing.ts`).
 */

import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';
import {
  asId,
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

  /** Names the opening that wrote the record: no other writes under its epoch. */
  readonly holder: string;
}

/** What a project's lease records say. */
export interface LeaseReading {
  /** The newest valid record, or epoch 0 and no seals before any writer opened the project. */
  readonly current: LeaseRecord;

  /** The highest epoch any record is named for, valid or not. */
  readonly highestNamed: number;
}

/** The lease of a project no writer has opened. */
const UNOPENED: LeaseRecord = { epoch: 0, seals: [], holder: '' };

const LEASE_MEMBERS: ReadonlySet<string> = new Set(['epoch', 'seals', 'holder']);
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

/** Whether the lease as read is the one an opening wrote: the same epoch, taken by it. */
export function isHeldBy(reading: LeaseReading, lease: LeaseRecord): boolean {
  return reading.current.epoch === lease.epoch && reading.current.holder === lease.holder;
}

/**
 * Claims the epoch past every one named, before the project is read. The
 * earlier seals are carried, and every epoch named past the current one, which
 * no opening confirmed and so none wrote under, is sealed at none.
 */
export async function claimEpoch(
  records: CheckedRecords,
  paths: ProjectPaths,
  holder: string,
  signal?: AbortSignal,
): Promise<DomainResult<LeaseRecord>> {
  const reading = await readLease(records, paths, signal);
  const seals = [...reading.current.seals, ...unconfirmedAfter(reading)];
  return await raiseEpoch(records, paths, reading, { seals, holder }, signal);
}

/**
 * Raises the epoch past a claim once the project is read, sealing the earlier
 * epochs as `seals` says and the claimed one at none. Refused where another
 * opening has claimed the project since.
 */
export async function sealEpoch(
  records: CheckedRecords,
  paths: ProjectPaths,
  claim: LeaseRecord,
  seals: readonly EpochSeal[],
  signal?: AbortSignal,
): Promise<DomainResult<LeaseRecord>> {
  const reading = await readLease(records, paths, signal);
  if (!isHeldBy(reading, claim)) return fail(notConfirmed());
  const sealed = [...seals, { epoch: claim.epoch, lastSequence: 0 }, ...unconfirmedAfter(reading)];
  return await raiseEpoch(records, paths, reading, { seals: sealed, holder: claim.holder }, signal);
}

/** The seals at none of every epoch named past the current one. */
function unconfirmedAfter(reading: LeaseReading): readonly EpochSeal[] {
  const seals: EpochSeal[] = [];
  for (let epoch = reading.current.epoch + 1; epoch <= reading.highestNamed; epoch += 1) {
    seals.push({ epoch, lastSequence: 0 });
  }
  return seals;
}

/** Raises the epoch past every one named, and confirms the record by reading it back. */
async function raiseEpoch(
  records: CheckedRecords,
  paths: ProjectPaths,
  reading: LeaseReading,
  lease: Omit<LeaseRecord, 'epoch'>,
  signal?: AbortSignal,
): Promise<DomainResult<LeaseRecord>> {
  const epoch = Math.max(reading.current.epoch, reading.highestNamed) + 1;
  const record: LeaseRecord = { ...lease, epoch };
  await records.write(paths.lease(epoch), RecordKind.Lease, writeLeaseRecord(record), signal);
  const back = await records.read(paths.lease(epoch), RecordKind.Lease, readLeaseRecord, signal);
  if (back.kind !== 'valid' || back.value.epoch !== epoch || back.value.holder !== lease.holder) {
    return fail(notConfirmed());
  }
  return succeed(back.value);
}

function notConfirmed() {
  return failure(
    'storage.lease-not-confirmed',
    FailureKind.Retryable,
    'The write lease could not be confirmed in storage, so the project was not opened to write.',
  );
}

function writeLeaseRecord(record: LeaseRecord): JsonObject {
  return {
    epoch: record.epoch,
    holder: record.holder,
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

/** The opening a record names, minted by the injected identifiers. */
const asHolder = asId<'LeaseHolder'>;

const readLeaseRecord: Converter<LeaseRecord> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, LEASE_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const epoch = required(reading, object, at, 'epoch', asWholeNumber);
  const seals = required(reading, object, at, 'seals', asSeals);
  const holder = required(reading, object, at, 'holder', asHolder);
  if (epoch === undefined || seals === undefined || holder === undefined) return undefined;
  if (seals.some((seal) => seal.epoch >= epoch)) {
    reading.refuse(
      'lease.seal-not-earlier',
      'A lease seals only earlier epochs.',
      pathOf(at, 'seals'),
    );
    return undefined;
  }
  return { epoch, seals, holder };
};
