/**
 * Reading a ZIP archive's central directory: finding its end records from the
 * end of the file, and reading and checking each entry's record (REQ-STOR-026,
 * REQ-STOR-099).
 *
 * An archive may come from anywhere, so nothing it says is trusted: every
 * record is refused unless it is one this package could have written, bar the
 * choices other tools make that are harmless, such as a local header that
 * carries its sizes or a folder listed on its own. The directory is read in
 * chunks, so a directory of a million entries is never one read.
 */

import { FailureKind, succeed, type DomainResult } from '@audiogubbins/domain';

import type { ByteSource } from './byte-ports.js';
import { decodeUtf8 } from './utf8.js';
import { locateDirectory, type ZipLimits } from './zip-end-records.js';
import { resolveZip64 } from './zip-extra.js';
import { ArchiveNames, entryNameBytes } from './zip-paths.js';
import { FieldReader, Flag, RecordLength, Signature, ZIP_CHUNK_BYTES } from './zip-records.js';
import { refuse, refuseMethod, shortRead } from './zip-refusals.js';

/** One record of the central directory, checked. */
export interface DirectoryRecord {
  /** The name, without the `/` that ends a folder's. */
  readonly path: string;
  readonly folder: boolean;

  /** The name as the record holds it, which the local header must repeat. */
  readonly nameBytes: Uint8Array;
  readonly crc: number;
  readonly size: number;
  readonly offset: number;
}

/** The records of a central directory, and where it starts. */
export interface CentralDirectory {
  readonly records: readonly DirectoryRecord[];
  readonly start: number;
}

/**
 * Reads and checks the central directory of the archive in `source`, holding
 * it to `limits` before any of it is read.
 */
export async function readCentralDirectory(
  source: ByteSource,
  limits: ZipLimits,
  signal?: AbortSignal,
): Promise<DomainResult<CentralDirectory>> {
  const located = await locateDirectory(source, limits, signal);
  if (!located.ok) return located;
  const { start, size, count } = located.value;

  const cursor = new DirectoryCursor(source, start, start + size, signal);
  const names = new ArchiveNames();
  const records: DirectoryRecord[] = [];
  for (let index = 0; index < count; index += 1) {
    const record = await readRecord(cursor, index);
    if (!record.ok) return record;

    const clash = record.value.folder
      ? names.addFolder(record.value.path)
      : names.addFile(record.value.path);
    if (clash !== undefined) {
      return refuse(
        clash === 'duplicate' ? 'zip.duplicate-path' : 'zip.file-and-folder',
        FailureKind.IntegrityViolation,
        clash === 'duplicate'
          ? 'Two entries have the same name, so which one is meant cannot be known.'
          : 'An entry is named as a file and as the folder of another.',
        { index },
      );
    }
    records.push(record.value);
  }

  if (cursor.position !== start + size) {
    return refuse(
      'zip.directory-malformed',
      FailureKind.IntegrityViolation,
      'The central directory holds bytes past the records its end record counts.',
    );
  }
  return succeed({ records, start });
}

/** Reads one central directory header and checks what it says. */
async function readRecord(
  cursor: DirectoryCursor,
  index: number,
): Promise<DomainResult<DirectoryRecord>> {
  const fixed = await cursor.take(RecordLength.CentralHeader);
  if (!fixed.ok) return fixed;
  const fields = new FieldReader(fixed.value);
  if (fields.u32(0) !== Signature.CentralHeader) {
    return refuse(
      'zip.directory-malformed',
      FailureKind.IntegrityViolation,
      'A central directory record does not begin with its signature.',
      { index },
    );
  }

  const flags = fields.u16(8);
  const nameLength = fields.u16(28);
  const extraLength = fields.u16(30);
  const variable = await cursor.take(nameLength + extraLength + fields.u16(32));
  if (!variable.ok) return variable;

  const refusedMethod = refuseMethod(flags, fields.u16(10));
  if (refusedMethod !== undefined) return refusedMethod;

  const extended = resolveZip64(variable.value.subarray(nameLength, nameLength + extraLength), {
    size: fields.u32(24),
    compressedSize: fields.u32(20),
    offset: fields.u32(42),
    disk: fields.u16(34),
  });
  if (!extended.ok) return extended;
  const { size, compressedSize, offset, disk } = extended.value;
  if (disk !== 0) {
    return refuse(
      'zip.multi-disk',
      FailureKind.Rejected,
      'An entry lies on another disk of a split archive, and AudioGubbins reads an archive of one file.',
      { index },
    );
  }
  if (size !== compressedSize) {
    return refuse(
      'zip.size-mismatch',
      FailureKind.IntegrityViolation,
      'A stored entry records different compressed and uncompressed sizes.',
      { index },
    );
  }

  const nameBytes = variable.value.slice(0, nameLength);
  const named = pathOf(nameBytes, flags, size, index);
  if (!named.ok) return named;
  return succeed({ ...named.value, nameBytes, crc: fields.u32(16), size, offset });
}

/** The path a record names, and whether it names a folder. */
function pathOf(
  nameBytes: Uint8Array,
  flags: number,
  size: number,
  index: number,
): DomainResult<{ readonly path: string; readonly folder: boolean }> {
  const name = decodeName(nameBytes, flags, index);
  if (!name.ok) return name;
  const folder = name.value.endsWith('/');
  const path = folder ? name.value.slice(0, -1) : name.value;
  if (entryNameBytes(path) === undefined) {
    return refuse(
      'zip.unsafe-path',
      FailureKind.Rejected,
      'An entry name is absolute, climbs out of the archive, or holds a backslash, colon or control character, so it could be written outside the folder it is unpacked into.',
      { index },
    );
  }
  if (folder && size !== 0) {
    return refuse(
      'zip.directory-malformed',
      FailureKind.IntegrityViolation,
      'A folder entry holds data.',
      { index },
    );
  }
  return succeed({ path, folder });
}

/**
 * An entry's name: strict UTF-8 where its flag says so, and printable ASCII
 * otherwise. The legacy code page CP437 some tools write other names in is
 * not decoded: AudioGubbins writes every name as UTF-8, and a name in a code
 * page could be read as a different name than the one meant.
 */
function decodeName(bytes: Uint8Array, flags: number, index: number): DomainResult<string> {
  if ((flags & Flag.Utf8Name) !== 0) {
    const decoded = decodeUtf8(bytes);
    if (decoded.ok) return decoded;
    return refuse(
      'zip.name-not-utf8',
      FailureKind.IntegrityViolation,
      'An entry name flagged as UTF-8 is not well-formed UTF-8.',
      { index },
      decoded.failures[0],
    );
  }
  if (!bytes.every((byte) => byte >= 0x20 && byte <= 0x7e)) {
    return refuse(
      'zip.name-not-ascii',
      FailureKind.Rejected,
      'An entry name is neither flagged as UTF-8 nor printable ASCII; names in a legacy code page such as CP437 are not read.',
      { index },
    );
  }
  return succeed(String.fromCharCode(...bytes));
}

/**
 * Reads the directory's bytes in order, a chunk at a time, refusing a record
 * that would run past the directory's end.
 */
class DirectoryCursor {
  private readonly source: ByteSource;
  private readonly end: number;
  private readonly signal: AbortSignal | undefined;
  private buffered = new Uint8Array(0);
  private bufferedStart: number;
  position: number;

  constructor(source: ByteSource, start: number, end: number, signal: AbortSignal | undefined) {
    this.source = source;
    this.end = end;
    this.signal = signal;
    this.bufferedStart = start;
    this.position = start;
  }

  /** The next `length` bytes, as a view valid until the next call. */
  async take(length: number): Promise<DomainResult<Uint8Array>> {
    if (this.position + length > this.end) {
      return refuse(
        'zip.directory-malformed',
        FailureKind.IntegrityViolation,
        'A central directory record runs past the end of the directory.',
        { offset: this.position },
      );
    }
    if (this.position + length > this.bufferedStart + this.buffered.length) {
      const readLength = Math.max(length, Math.min(ZIP_CHUNK_BYTES, this.end - this.position));
      this.signal?.throwIfAborted();
      this.buffered = await this.source.read(this.position, readLength, this.signal);
      this.bufferedStart = this.position;
      if (this.buffered.length !== readLength) return shortRead(this.position);
    }
    const from = this.position - this.bufferedStart;
    this.position += length;
    return succeed(this.buffered.subarray(from, from + length));
  }
}
