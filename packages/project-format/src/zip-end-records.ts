/**
 * Finding a ZIP archive's central directory from its end records: the end of
 * central directory record, found by searching back from the end of the file,
 * and the ZIP64 locator and record it may point past (REQ-STOR-026,
 * REQ-STOR-099).
 *
 * Only the end of the file is read, so an archive of many gigabytes is opened
 * in a few small reads, and the directory's size and count are held to the
 * caller's limits before any of it is read.
 */

import { FailureKind, succeed, type DomainResult } from '@audiogubbins/domain';

import type { ByteSource } from './byte-ports.js';
import {
  FieldReader,
  LONGEST_COMMENT,
  RecordLength,
  SENTINEL_16,
  SENTINEL_32,
  Signature,
} from './zip-records.js';
import { refuse, shortRead } from './zip-refusals.js';

/** How large a central directory an archive may have before it is read. */
export interface ZipLimits {
  readonly maxEntries: number;
  readonly maxDirectoryBytes: number;
}

/** Where the central directory lies, and how many records it holds. */
interface DirectoryLocation {
  readonly start: number;
  readonly size: number;
  readonly count: number;
}

/** What the plain end record says. */
interface EndRecord {
  readonly position: number;

  /** The bytes before the record where a ZIP64 locator would stand, when read with it. */
  readonly locator: Uint8Array | undefined;
  readonly disk: number;
  readonly directoryDisk: number;
  readonly countOnDisk: number;
  readonly count: number;
  readonly size: number;
  readonly start: number;
}

/**
 * Finds the central directory of the archive in `source`. The directory must
 * end exactly where the end records begin: an archive with bytes before it or
 * between its records is not one this package wrote, and offsets that do not
 * add up are how a truncated or spliced archive shows.
 */
export async function locateDirectory(
  source: ByteSource,
  limits: ZipLimits,
  signal?: AbortSignal,
): Promise<DomainResult<DirectoryLocation>> {
  const end = await findEndRecord(source, signal);
  if (!end.ok) return end;

  const extended = await readZip64End(source, end.value, signal);
  if (!extended.ok) return extended;
  const { start, size, count, directoryEnd } = extended.value;

  if (count > limits.maxEntries) {
    return refuse(
      'zip.too-many-entries',
      FailureKind.Rejected,
      'The archive holds more entries than the limit allows.',
      { count, limit: limits.maxEntries },
    );
  }
  if (size > limits.maxDirectoryBytes) {
    return refuse(
      'zip.directory-too-large',
      FailureKind.Rejected,
      'The archive’s central directory is larger than the limit allows.',
      { size, limit: limits.maxDirectoryBytes },
    );
  }
  if (start + size !== directoryEnd || count * RecordLength.CentralHeader > size) {
    return refuse(
      'zip.directory-misplaced',
      FailureKind.IntegrityViolation,
      'The central directory does not end where the end records begin, or is too small for the records it counts, so the archive is truncated or altered.',
    );
  }
  return succeed({ start, size, count });
}

/**
 * The end record: the last place, searching back over at most the record and
 * the longest comment, where the signature stands and the comment length
 * reaches the end of the file exactly.
 */
async function findEndRecord(
  source: ByteSource,
  signal?: AbortSignal,
): Promise<DomainResult<EndRecord>> {
  const tailLength = Math.min(source.size, RecordLength.EndRecord + LONGEST_COMMENT);
  const tailStart = source.size - tailLength;
  signal?.throwIfAborted();
  const tail = await source.read(tailStart, tailLength, signal);
  if (tail.length !== tailLength) return shortRead(tailStart);

  const fields = new FieldReader(tail);
  for (let at = tailLength - RecordLength.EndRecord; at >= 0; at -= 1) {
    if (
      fields.u32(at) === Signature.EndRecord &&
      at + RecordLength.EndRecord + fields.u16(at + 20) === tailLength
    ) {
      return succeed({
        position: tailStart + at,
        locator:
          at >= RecordLength.Zip64Locator
            ? tail.subarray(at - RecordLength.Zip64Locator, at)
            : undefined,
        disk: fields.u16(at + 4),
        directoryDisk: fields.u16(at + 6),
        countOnDisk: fields.u16(at + 8),
        count: fields.u16(at + 10),
        size: fields.u32(at + 12),
        start: fields.u32(at + 16),
      });
    }
  }
  return refuse(
    'zip.end-record-missing',
    FailureKind.IntegrityViolation,
    'The file has no end of central directory record, so it is not a ZIP archive or its end is missing.',
  );
}

/** The directory's place, from the ZIP64 end record where a locator points to one. */
async function readZip64End(
  source: ByteSource,
  end: EndRecord,
  signal?: AbortSignal,
): Promise<DomainResult<DirectoryLocation & { readonly directoryEnd: number }>> {
  // The locator was read with the end record unless the end record's comment
  // filled the search, or the file is too short to hold one.
  const locatorAt = end.position - RecordLength.Zip64Locator;
  let locator = end.locator;
  if (locator === undefined && locatorAt >= 0) {
    const read = await readAt(source, locatorAt, RecordLength.Zip64Locator, signal);
    if (!read.ok) return read;
    locator = read.value;
  }

  const locatorFields = locator === undefined ? undefined : new FieldReader(locator);
  if (locatorFields?.u32(0) !== Signature.Zip64Locator) {
    if (end.disk !== 0 || end.directoryDisk !== 0 || end.countOnDisk !== end.count) {
      return multiDisk();
    }
    return succeed({
      start: end.start,
      size: end.size,
      count: end.count,
      directoryEnd: end.position,
    });
  }

  const recordAt = locatorFields.u64(8);
  if (locatorFields.u32(4) !== 0 || locatorFields.u32(16) > 1) return multiDisk();
  if (recordAt === undefined || recordAt + RecordLength.Zip64EndRecord > locatorAt) {
    return malformedEnd();
  }
  const record = await readAt(source, recordAt, RecordLength.Zip64EndRecord, signal);
  if (!record.ok) return record;

  const fields = new FieldReader(record.value);
  const countOnDisk = fields.u64(24);
  const count = fields.u64(32);
  const size = fields.u64(40);
  const start = fields.u64(48);
  if (
    fields.u32(0) !== Signature.Zip64EndRecord ||
    recordAt + 12 + (fields.u64(4) ?? Number.MAX_SAFE_INTEGER) !== locatorAt ||
    count === undefined ||
    size === undefined ||
    start === undefined ||
    !agrees(end.count, count, SENTINEL_16) ||
    !agrees(end.countOnDisk, count, SENTINEL_16) ||
    !agrees(end.size, size, SENTINEL_32) ||
    !agrees(end.start, start, SENTINEL_32)
  ) {
    return malformedEnd();
  }
  if (fields.u32(16) !== 0 || fields.u32(20) !== 0 || countOnDisk !== count) return multiDisk();
  return succeed({ start, size, count, directoryEnd: recordAt });
}

/** Whether a plain end record field is its sentinel or the ZIP64 record's value. */
function agrees(plain: number, extended: number, sentinel: number): boolean {
  return plain === sentinel || plain === extended;
}

/** `length` bytes at `offset`, refusing a short read. */
async function readAt(
  source: ByteSource,
  offset: number,
  length: number,
  signal?: AbortSignal,
): Promise<DomainResult<Uint8Array>> {
  signal?.throwIfAborted();
  const bytes = await source.read(offset, length, signal);
  return bytes.length === length ? succeed(bytes) : shortRead(offset);
}

function multiDisk(): DomainResult<never> {
  return refuse(
    'zip.multi-disk',
    FailureKind.Rejected,
    'The archive is split across disks, and AudioGubbins reads an archive of one file.',
  );
}

function malformedEnd(): DomainResult<never> {
  return refuse(
    'zip.end-record-malformed',
    FailureKind.IntegrityViolation,
    'The ZIP64 end records are missing, inconsistent with the end record, or point outside the file.',
  );
}
