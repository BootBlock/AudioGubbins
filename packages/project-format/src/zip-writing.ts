/**
 * Writing a ZIP archive, entry by entry, to a sink: the container of the
 * portable bundle (REQ-STOR-026, REQ-STOR-099) and of the raw data exported
 * before a schema reset (REQ-STOR-052).
 *
 * Audio does not compress, so every entry is stored as it is, and an entry is
 * read from its source one chunk at a time and never held whole
 * (REQ-EXEC-216). Its CRC-32 is known only once the last chunk is written, so
 * it follows the data in a data descriptor and the archive is written in one
 * pass. Every entry has the same fixed date, so the same entries in the same
 * order are the same bytes whenever they are written (REQ-STOR-103). ZIP64
 * records are written exactly where a size, offset or count does not fit the
 * plain fields.
 */

import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';

import type { ByteSink, ByteSource } from './byte-ports.js';
import { crc32 } from './crc32.js';
import { Turns, type YieldToHost } from './work-turns.js';
import { ArchiveNames, entryNameBytes } from './zip-paths.js';
import {
  EXTERNAL_ATTRIBUTES,
  FIXED_DOS_DATE,
  FieldWriter,
  MADE_BY,
  PLAIN_LIMITS,
  RecordLength,
  SENTINEL_16,
  SENTINEL_32,
  STORED,
  Signature,
  Version,
  WRITTEN_FLAGS,
  ZIP64_EXTRA_TAG,
  ZIP_CHUNK_BYTES,
} from './zip-records.js';

/** One file to write into an archive. */
export interface ZipEntryInput {
  /**
   * The entry's name: relative, `/`-separated, with no empty, `.` or `..`
   * segment, no backslash, colon or control character, and at most 65,535
   * bytes of UTF-8. A folder is never written; it is implied by the names in
   * it.
   */
  readonly path: string;
  readonly source: ByteSource | Uint8Array<ArrayBuffer>;
}

/** What writing an archive may be told. */
export interface ZipWritingOptions {
  readonly signal?: AbortSignal;

  /** Called after each write with the bytes of the archive written so far. */
  readonly onProgress?: (written: number) => void;

  /**
   * Asked after each chunk is checksummed and each directory record made,
   * since a source's reads and the sink's writes may resolve at once.
   */
  readonly yieldToHost: YieldToHost;
}

/** What an archive that was written holds. */
export interface ZipWritten {
  readonly entries: number;
  readonly bytes: number;
}

/**
 * Writes `entries` in order as a ZIP archive into `sink`, and closes it.
 *
 * Fails, having abandoned the sink, with `zip.unsafe-path` for a name outside
 * the rule of {@link ZipEntryInput.path}, `zip.duplicate-path` for a name given
 * twice, `zip.file-and-folder` for a name that is both a file and a folder of
 * another, and `zip.short-read` when a source returns other than the bytes
 * asked for. Rejects with the reason, having abandoned the sink too, when
 * `signal` aborts or a source, the sink or `entries` rejects, so a half archive
 * is never closed as a whole one.
 */
export async function writeZip(
  entries: AsyncIterable<ZipEntryInput> | Iterable<ZipEntryInput>,
  sink: ByteSink,
  options: ZipWritingOptions,
): Promise<DomainResult<ZipWritten>> {
  const archive = new ArchiveWriter(sink, options);
  let written: ZipWritten;
  try {
    for await (const entry of entries) {
      options.signal?.throwIfAborted();
      const added = await archive.add(entry);
      if (!added.ok) {
        await sink.abort(added.failures[0]);
        return added;
      }
    }
    options.signal?.throwIfAborted();
    written = await archive.finish();
  } catch (error: unknown) {
    // Whatever failed, the sink holds part of an archive: abandon it before
    // passing the failure on, so it is never kept as a whole one.
    await sink.abort(error);
    throw error;
  }
  await sink.close();
  return succeed(written);
}

/** What the central directory records of an entry once it is written. */
interface WrittenEntry {
  readonly name: Uint8Array<ArrayBuffer>;
  readonly crc: number;
  readonly size: number;
  readonly offset: number;
}

/** An archive being written: where it has reached and what it holds. */
class ArchiveWriter {
  private readonly sink: ByteSink;
  private readonly options: ZipWritingOptions;
  private readonly turns: Turns;
  private readonly names = new ArchiveNames();
  private readonly written: WrittenEntry[] = [];
  private offset = 0;

  constructor(sink: ByteSink, options: ZipWritingOptions) {
    this.sink = sink;
    this.options = options;
    this.turns = new Turns(options.yieldToHost, options.signal);
  }

  /** Writes one entry: its local header, its data and its data descriptor. */
  async add(entry: ZipEntryInput): Promise<DomainResult<void>> {
    const name = entryNameBytes(entry.path);
    if (name === undefined) {
      return fail(
        failure(
          'zip.unsafe-path',
          FailureKind.Rejected,
          'An entry name must be a relative path of named segments with no backslash, colon or control character, in at most 65,535 bytes.',
        ),
      );
    }
    const clash = this.names.addFile(entry.path);
    if (clash !== undefined) {
      return fail(
        failure(
          clash === 'duplicate' ? 'zip.duplicate-path' : 'zip.file-and-folder',
          FailureKind.Rejected,
          clash === 'duplicate'
            ? 'Two entries have the same name.'
            : 'An entry is named as a file and as the folder of another.',
        ),
      );
    }

    // Told apart by what the bytes are, not by `instanceof`, which answers for
    // one realm's arrays alone and so not for bytes cloned from another's.
    const source = ArrayBuffer.isView(entry.source) ? bytesSource(entry.source) : entry.source;
    if (!Number.isSafeInteger(source.size) || source.size < 0) {
      throw new RangeError('A byte source reports its size as a whole number of bytes.');
    }
    const offset = this.offset;
    const zip64Sizes = source.size > PLAIN_LIMITS.largestField;
    const version =
      zip64Sizes || offset > PLAIN_LIMITS.largestField ? Version.Zip64 : Version.Plain;

    await this.write(localHeader(name, version, zip64Sizes));
    const crc = await this.copy(source);
    if (crc === undefined) {
      return fail(
        failure(
          'zip.short-read',
          FailureKind.IntegrityViolation,
          'A source returned other than the bytes asked for, so it changed while it was written.',
        ),
      );
    }
    await this.write(dataDescriptor(crc, source.size, zip64Sizes));
    this.written.push({ name, crc, size: source.size, offset });
    return succeed(undefined);
  }

  /** Writes the central directory and the end records, and says what was written. */
  async finish(): Promise<ZipWritten> {
    const directoryOffset = this.offset;
    await this.writeDirectory();
    const directorySize = this.offset - directoryOffset;

    const count = this.written.length;
    if (
      count > PLAIN_LIMITS.largestCount ||
      directorySize > PLAIN_LIMITS.largestField ||
      directoryOffset > PLAIN_LIMITS.largestField
    ) {
      const zip64EndOffset = this.offset;
      await this.write(zip64EndRecord(count, directorySize, directoryOffset));
      await this.write(zip64Locator(zip64EndOffset));
    }
    await this.write(endRecord(count, directorySize, directoryOffset));
    return { entries: count, bytes: this.offset };
  }

  /** Copies `source` in chunks, giving its CRC-32, or `undefined` on a short read. */
  private async copy(source: ByteSource): Promise<number | undefined> {
    const { signal } = this.options;
    let crc = 0;
    for (let at = 0; at < source.size; at += ZIP_CHUNK_BYTES) {
      signal?.throwIfAborted();
      const length = Math.min(ZIP_CHUNK_BYTES, source.size - at);
      const chunk = await source.read(at, length, signal);
      if (chunk.length !== length) return undefined;
      crc = crc32(chunk, crc);
      await this.write(chunk);
      await this.turns.afterHeavyStep();
    }
    return crc;
  }

  /**
   * Writes the central directory, its headers gathered into chunks rather
   * than written one at a time, and made as they are gathered rather than all
   * at once.
   */
  private async writeDirectory(): Promise<void> {
    let batch: Uint8Array[] = [];
    let batchBytes = 0;
    for (const entry of this.written) {
      await this.turns.afterStep();
      const record = centralHeader(entry);
      batch.push(record);
      batchBytes += record.length;
      if (batchBytes >= ZIP_CHUNK_BYTES) {
        await this.write(joined(batch, batchBytes));
        batch = [];
        batchBytes = 0;
      }
    }
    if (batchBytes > 0) await this.write(joined(batch, batchBytes));
  }

  private async write(bytes: Uint8Array): Promise<void> {
    await this.sink.write(bytes);
    this.offset += bytes.length;
    this.options.onProgress?.(this.offset);
  }
}

/** Bytes already in memory, as a source read in views rather than copies. */
function bytesSource(bytes: Uint8Array<ArrayBuffer>): ByteSource {
  return {
    size: bytes.length,
    read: (offset, length) => Promise.resolve(bytes.subarray(offset, offset + length)),
  };
}

/** Records of known total length, joined into one. */
function joined(records: readonly Uint8Array[], length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const record of records) {
    bytes.set(record, offset);
    offset += record.length;
  }
  return bytes;
}

/**
 * The local header. The CRC and sizes follow the data, so they are zero here;
 * a ZIP64 extra field of zero sizes says the data descriptor's sizes are
 * 64-bit.
 */
function localHeader(
  name: Uint8Array,
  version: number,
  zip64Sizes: boolean,
): Uint8Array<ArrayBuffer> {
  const extraLength = zip64Sizes ? 20 : 0;
  const header = new FieldWriter(RecordLength.LocalHeader + name.length + extraLength)
    .u32(Signature.LocalHeader)
    .u16(version)
    .u16(WRITTEN_FLAGS)
    .u16(STORED)
    .u16(0)
    .u16(FIXED_DOS_DATE)
    .u32(0)
    .u32(zip64Sizes ? SENTINEL_32 : 0)
    .u32(zip64Sizes ? SENTINEL_32 : 0)
    .u16(name.length)
    .u16(extraLength)
    .raw(name);
  if (zip64Sizes) header.u16(ZIP64_EXTRA_TAG).u16(16).u64(0).u64(0);
  return header.done();
}

/** The CRC and sizes that follow an entry's data. */
function dataDescriptor(crc: number, size: number, zip64Sizes: boolean): Uint8Array<ArrayBuffer> {
  if (zip64Sizes) {
    return new FieldWriter(RecordLength.Zip64DataDescriptor)
      .u32(Signature.DataDescriptor)
      .u32(crc)
      .u64(size)
      .u64(size)
      .done();
  }
  return new FieldWriter(RecordLength.DataDescriptor)
    .u32(Signature.DataDescriptor)
    .u32(crc)
    .u32(size)
    .u32(size)
    .done();
}

/**
 * An entry's central directory header, with a ZIP64 extra field holding the
 * sizes and the offset that do not fit the plain fields, in the order the
 * format fixes.
 */
function centralHeader(entry: WrittenEntry): Uint8Array<ArrayBuffer> {
  const zip64Sizes = entry.size > PLAIN_LIMITS.largestField;
  const zip64Offset = entry.offset > PLAIN_LIMITS.largestField;
  const extraData = (zip64Sizes ? 16 : 0) + (zip64Offset ? 8 : 0);
  const extraLength = extraData === 0 ? 0 : 4 + extraData;

  const header = new FieldWriter(RecordLength.CentralHeader + entry.name.length + extraLength)
    .u32(Signature.CentralHeader)
    .u16(MADE_BY)
    .u16(zip64Sizes || zip64Offset ? Version.Zip64 : Version.Plain)
    .u16(WRITTEN_FLAGS)
    .u16(STORED)
    .u16(0)
    .u16(FIXED_DOS_DATE)
    .u32(entry.crc)
    .u32(zip64Sizes ? SENTINEL_32 : entry.size)
    .u32(zip64Sizes ? SENTINEL_32 : entry.size)
    .u16(entry.name.length)
    .u16(extraLength)
    .u16(0)
    .u16(0)
    .u16(0)
    .u32(EXTERNAL_ATTRIBUTES)
    .u32(zip64Offset ? SENTINEL_32 : entry.offset)
    .raw(entry.name);
  if (extraLength > 0) header.u16(ZIP64_EXTRA_TAG).u16(extraData);
  if (zip64Sizes) header.u64(entry.size).u64(entry.size);
  if (zip64Offset) header.u64(entry.offset);
  return header.done();
}

/** The ZIP64 end of central directory record, of one disk. */
function zip64EndRecord(count: number, size: number, offset: number): Uint8Array<ArrayBuffer> {
  return new FieldWriter(RecordLength.Zip64EndRecord)
    .u32(Signature.Zip64EndRecord)
    .u64(RecordLength.Zip64EndRecord - 12)
    .u16(MADE_BY)
    .u16(Version.Zip64)
    .u32(0)
    .u32(0)
    .u64(count)
    .u64(count)
    .u64(size)
    .u64(offset)
    .done();
}

/** Where the ZIP64 end record is, in an archive of one disk. */
function zip64Locator(zip64EndOffset: number): Uint8Array<ArrayBuffer> {
  return new FieldWriter(RecordLength.Zip64Locator)
    .u32(Signature.Zip64Locator)
    .u32(0)
    .u64(zip64EndOffset)
    .u32(1)
    .done();
}

/** The end record, with a sentinel in each field whose value only the ZIP64 record holds. */
function endRecord(count: number, size: number, offset: number): Uint8Array<ArrayBuffer> {
  const countField = count > PLAIN_LIMITS.largestCount ? SENTINEL_16 : count;
  return new FieldWriter(RecordLength.EndRecord)
    .u32(Signature.EndRecord)
    .u16(0)
    .u16(0)
    .u16(countField)
    .u16(countField)
    .u32(size > PLAIN_LIMITS.largestField ? SENTINEL_32 : size)
    .u32(offset > PLAIN_LIMITS.largestField ? SENTINEL_32 : offset)
    .u16(0)
    .done();
}
