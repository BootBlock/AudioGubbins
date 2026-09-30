/**
 * A record kept as two files rewritten by turns, for the few records that must
 * change in place: a project's head and its header (ADR-0020, REQ-STOR-101).
 *
 * The tree cannot replace a file atomically, so a record that changes is never
 * rewritten where the current one lies. Each file carries a generation; the
 * valid file with the higher generation is current, and the next write goes to
 * the other file with the next generation. A write torn by a crash leaves that
 * file invalid and the current one untouched, so a reader finds either the new
 * record or the one before it, never neither. A write counts only once it reads
 * back valid.
 */

import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';
import type { Converter, JsonValue } from '@audiogubbins/project-format';

import type { CheckedRecords, RecordFault, RecordKind } from './checked-records.js';
import type { PairSlot } from './storage-layout.js';

/** A record of a pair, which carries its generation. */
export interface Generational {
  readonly generation: number;
}

/** A record of a pair, and the file of the two it was read from. */
export interface Slotted<TValue> {
  readonly slot: PairSlot;
  readonly value: TValue;
}

/** What reading both files of a pair found. */
export interface PairReading<TValue> {
  /** The valid records, the newest generation first. */
  readonly valid: readonly Slotted<TValue>[];

  /** Each file that holds something other than a valid record, and why. */
  readonly faults: readonly { readonly slot: PairSlot; readonly fault: RecordFault }[];
}

/** Where each file of a pair lies, and what it holds. */
export interface PairFiles<TValue extends Generational> {
  readonly path: (slot: PairSlot) => string;
  readonly kind: RecordKind;
  readonly convert: Converter<TValue>;
}

const SLOTS: readonly PairSlot[] = [0, 1];

/** Reads both files of a pair. */
export async function readPair<TValue extends Generational>(
  records: CheckedRecords,
  files: PairFiles<TValue>,
  signal?: AbortSignal,
): Promise<PairReading<TValue>> {
  const valid: Slotted<TValue>[] = [];
  const faults: { slot: PairSlot; fault: RecordFault }[] = [];
  for (const slot of SLOTS) {
    const read = await records.read(files.path(slot), files.kind, files.convert, signal);
    if (read.kind === 'valid') valid.push({ slot, value: read.value });
    else if (read.kind === 'invalid') faults.push({ slot, fault: read.fault });
  }
  valid.sort(
    (left, right) => right.value.generation - left.value.generation || left.slot - right.slot,
  );
  return { valid, faults };
}

/**
 * Writes the next record of a pair over the file that does not hold the current
 * one, and confirms it by reading it back. `build` makes the record and its
 * body for the generation it is written with.
 */
export async function writeNext<TValue extends Generational>(
  records: CheckedRecords,
  files: PairFiles<TValue>,
  current: PairReading<TValue>,
  build: (generation: number) => JsonValue,
  signal?: AbortSignal,
): Promise<DomainResult<Slotted<TValue>>> {
  const newest = current.valid[0];
  const slot: PairSlot = newest?.slot === 0 ? 1 : 0;
  const generation = (newest?.value.generation ?? 0) + 1;
  const written = await records.write(files.path(slot), files.kind, build(generation), signal);
  if (!written.ok) return written;

  const back = await records.read(files.path(slot), files.kind, files.convert, signal);
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
  return succeed({ slot, value: back.value });
}
