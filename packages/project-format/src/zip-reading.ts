/**
 * Opening a ZIP archive over a byte source and reading its entries: the
 * container of the portable bundle (REQ-STOR-026, REQ-STOR-099) and of the raw
 * data exported before a schema reset (REQ-STOR-052).
 *
 * Opening reads only the end of the archive and its central directory. An
 * entry's local header is checked when the entry is opened, and its data is
 * read in ranges from the archive itself, so no entry is ever held whole
 * (REQ-EXEC-216). No two entries may share bytes, and none may reach into the
 * directory: that is how an archive far smaller than what it unpacks to is
 * built, so it is refused rather than read.
 */

import { FailureKind, succeed, type DomainResult } from '@audiogubbins/domain';

import type { ByteSource } from './byte-ports.js';
import { crc32 } from './crc32.js';
import { Turns, type YieldToHost } from './work-turns.js';
import { readCentralDirectory, type DirectoryRecord } from './zip-directory.js';
import type { ZipLimits } from './zip-end-records.js';
import { resolveZip64 } from './zip-extra.js';
import { FieldReader, Flag, RecordLength, Signature, ZIP_CHUNK_BYTES } from './zip-records.js';
import { refuse, refuseMethod, shortRead } from './zip-refusals.js';

/** The limits an archive is held to when the caller names none. */
const DEFAULT_LIMITS: ZipLimits = { maxEntries: 1_000_000, maxDirectoryBytes: 268_435_456 };

/** What opening an archive may be told. */
export interface ZipReadingOptions {
  readonly signal?: AbortSignal;

  /** Asked between records of the directory, which are read from memory. */
  readonly yieldToHost: YieldToHost;

  /**
   * The most entries and directory bytes to accept, by default 1,000,000 and
   * 256 MiB.
   */
  readonly limits?: Partial<ZipLimits>;
}

/** One file in an archive. Folders are implied by the names and not listed. */
export interface ZipEntry {
  readonly path: string;
  readonly size: number;
  readonly crc32: number;

  /**
   * The entry's data as a source of exactly {@link ZipEntry.size} bytes, once
   * its local header is checked. The data is not checked against its CRC-32:
   * read it through {@link readVerified} for that.
   */
  open(signal?: AbortSignal): Promise<DomainResult<ByteSource>>;
}

/** An open archive's entries, in the order of its central directory. */
export interface ZipArchive {
  readonly entries: readonly ZipEntry[];
}

/** What reading an entry through {@link readVerified} may be told. */
export interface VerifiedReadingOptions {
  readonly signal?: AbortSignal;

  /** Asked after each chunk is checksummed, since its read may resolve at once. */
  readonly yieldToHost: YieldToHost;
}

/**
 * Opens the archive in `source`, reading its end records and its central
 * directory and refusing, with a `zip.*` code, anything this package would not
 * have written but for harmless choices of other tools: see
 * {@link readCentralDirectory}. Rejects with the signal's reason when `signal`
 * aborts.
 */
export async function openZip(
  source: ByteSource,
  options: ZipReadingOptions,
): Promise<DomainResult<ZipArchive>> {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const turns = new Turns(options.yieldToHost, options.signal);
  const directory = await readCentralDirectory(source, limits, turns);
  if (!directory.ok) return directory;
  const { records, start } = directory.value;

  // Each record's bytes end before the next record's local header, or the
  // directory for the last; a local header's extra field is not known until it
  // is read, so the entry checks that it fits too when it is opened.
  const byOffset = records
    .map((record, index) => ({ record, index }))
    .toSorted((one, other) => one.record.offset - other.record.offset);
  const inDirectoryOrder: (ZipEntry | undefined)[] = new Array<undefined>(records.length);
  for (const [at, { record, index }] of byOffset.entries()) {
    await turns.afterStep();
    const limit = byOffset[at + 1]?.record.offset ?? start;
    if (dataStart(record, record.nameBytes.length) + record.size > limit) return overlapping();
    if (!record.folder) inDirectoryOrder[index] = new StoredEntry(source, record, limit);
  }
  return succeed({
    entries: inDirectoryOrder.filter((entry): entry is ZipEntry => entry !== undefined),
  });
}

/**
 * Reads every byte of `entry` in chunks, handing each to `consume` in order,
 * and fails with `zip.crc-mismatch` when the bytes do not match the entry's
 * CRC-32. The bytes are known good only once this succeeds: a caller writes
 * them somewhere it can abandon, such as a sink it aborts on failure.
 */
export async function readVerified(
  entry: ZipEntry,
  consume: (chunk: Uint8Array<ArrayBuffer>) => Promise<void>,
  options: VerifiedReadingOptions,
): Promise<DomainResult<void>> {
  const { signal } = options;
  const turns = new Turns(options.yieldToHost, signal);
  const opened = await entry.open(signal);
  if (!opened.ok) return opened;
  const data = opened.value;

  let crc = 0;
  for (let at = 0; at < data.size; at += ZIP_CHUNK_BYTES) {
    signal?.throwIfAborted();
    const length = Math.min(ZIP_CHUNK_BYTES, data.size - at);
    const chunk = await data.read(at, length, signal);
    if (chunk.length !== length) return shortRead(at);
    crc = crc32(chunk, crc);
    await consume(chunk);
    await turns.afterHeavyStep();
  }
  if (crc !== entry.crc32) {
    return refuse(
      'zip.crc-mismatch',
      FailureKind.IntegrityViolation,
      'An entry’s data does not match its CRC-32, so it changed after it was written.',
    );
  }
  return succeed(undefined);
}

/** An entry stored as it is, whose data must end by `limit`. */
class StoredEntry implements ZipEntry {
  readonly path: string;
  readonly size: number;
  readonly crc32: number;
  private readonly record: DirectoryRecord;
  private readonly source: ByteSource;
  private readonly limit: number;

  constructor(source: ByteSource, record: DirectoryRecord, limit: number) {
    this.path = record.path;
    this.size = record.size;
    this.crc32 = record.crc;
    this.record = record;
    this.source = source;
    this.limit = limit;
  }

  async open(signal?: AbortSignal): Promise<DomainResult<ByteSource>> {
    const { offset, nameBytes } = this.record;
    signal?.throwIfAborted();
    const header = await this.source.read(offset, RecordLength.LocalHeader, signal);
    if (header.length !== RecordLength.LocalHeader) return shortRead(offset);
    const fields = new FieldReader(header);
    if (fields.u32(0) !== Signature.LocalHeader) {
      return localMismatch('An entry’s local header does not begin with its signature.');
    }

    const flags = fields.u16(6);
    const refusedMethod = refuseMethod(flags, fields.u16(8));
    if (refusedMethod !== undefined) return refusedMethod;

    const nameLength = fields.u16(26);
    const extraLength = fields.u16(28);
    const start = dataStart(this.record, nameLength + extraLength);
    if (start + this.size > this.limit) return overlapping();

    signal?.throwIfAborted();
    const variableAt = offset + RecordLength.LocalHeader;
    const variable = await this.source.read(variableAt, nameLength + extraLength, signal);
    if (variable.length !== nameLength + extraLength) return shortRead(variableAt);
    const name = variable.subarray(0, nameLength);
    if (name.length !== nameBytes.length || !name.every((byte, at) => byte === nameBytes[at])) {
      return localMismatch('An entry’s local header names a different file than the directory.');
    }

    const local = resolveZip64(variable.subarray(nameLength), {
      size: fields.u32(22),
      compressedSize: fields.u32(18),
      offset: 0,
      disk: 0,
    });
    if (!local.ok) return local;
    // A local header written before its data carries zeros where a data
    // descriptor follows; any value it does carry must be the directory's.
    const deferred = (flags & Flag.DataDescriptor) !== 0;
    const matches = (value: number, expected: number): boolean =>
      value === expected || (deferred && value === 0);
    if (
      !matches(fields.u32(14), this.crc32) ||
      !matches(local.value.size, this.size) ||
      !matches(local.value.compressedSize, this.size)
    ) {
      return localMismatch(
        'An entry’s local header disagrees with the directory on its CRC or size.',
      );
    }
    return succeed(rangeOf(this.source, start, this.size));
  }
}

/** Where a record's data starts, given the length of its local name and extra field. */
function dataStart(record: DirectoryRecord, variableLength: number): number {
  return record.offset + RecordLength.LocalHeader + variableLength;
}

/** The `size` bytes of `source` from `start`, as a source of their own. */
function rangeOf(source: ByteSource, start: number, size: number): ByteSource {
  return {
    size,
    read: async (offset, length, signal) => {
      if (offset < 0 || length < 0 || offset + length > size) {
        throw new RangeError('A read of an entry lies outside the entry.');
      }
      return await source.read(start + offset, length, signal);
    },
  };
}

function overlapping(): DomainResult<never> {
  return refuse(
    'zip.overlapping-entries',
    FailureKind.IntegrityViolation,
    'Two entries share bytes, or an entry reaches into the central directory, as an archive built to unpack far larger than it is does.',
  );
}

function localMismatch(summary: string): DomainResult<never> {
  return refuse('zip.local-header-mismatch', FailureKind.IntegrityViolation, summary);
}
