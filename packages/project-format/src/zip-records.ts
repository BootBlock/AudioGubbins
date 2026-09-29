/**
 * The layout of the ZIP records a portable bundle is made of: their
 * signatures, fixed lengths and flags, and the little-endian fields they are
 * written in (PKWARE APPNOTE 6.3.10; REQ-STOR-026, REQ-STOR-103).
 *
 * The writer and the reader take every number from here, so the two cannot
 * disagree about the format.
 */

/** The signatures each record opens with. */
export const Signature = {
  LocalHeader: 0x04034b50,
  DataDescriptor: 0x08074b50,
  CentralHeader: 0x02014b50,
  Zip64EndRecord: 0x06064b50,
  Zip64Locator: 0x07064b50,
  EndRecord: 0x06054b50,
} as const;

/** The length of each record before its variable fields. */
export const RecordLength = {
  LocalHeader: 30,
  DataDescriptor: 16,
  Zip64DataDescriptor: 24,
  CentralHeader: 46,
  Zip64EndRecord: 56,
  Zip64Locator: 20,
  EndRecord: 22,
} as const;

/** The general purpose flag bits this format reads or writes. */
export const Flag = {
  /** The entry is encrypted. */
  Encrypted: 0x0001,

  /** The CRC and sizes follow the data in a data descriptor. */
  DataDescriptor: 0x0008,

  /** The entry is encrypted with PKWARE's strong encryption. */
  StrongEncryption: 0x0040,

  /** The name is UTF-8. */
  Utf8Name: 0x0800,

  /** The central directory is encrypted and its local headers masked. */
  MaskedHeaders: 0x2000,
} as const;

/** The flags of every entry written: a data descriptor and a UTF-8 name. */
export const WRITTEN_FLAGS = Flag.DataDescriptor | Flag.Utf8Name;

/** Any of the flags that mean an entry cannot be read without a key. */
export const ENCRYPTION_FLAGS = Flag.Encrypted | Flag.StrongEncryption | Flag.MaskedHeaders;

/** The method of an entry stored as it is, the only one written or read. */
export const STORED = 0;

/** The ZIP64 extended information extra field's tag. */
export const ZIP64_EXTRA_TAG = 0x0001;

/**
 * The version an entry needs to be extracted: 2.0 for a data descriptor, 4.5
 * for ZIP64.
 */
export const Version = { Plain: 20, Zip64: 45 } as const;

/**
 * The creating system and version: Unix, so an extracting tool reads the
 * external attributes as a Unix mode, and 4.5, the version of ZIP64.
 */
export const MADE_BY = (3 << 8) | Version.Zip64;

/** A regular file readable by everyone and writable by its owner, as a Unix mode. */
export const EXTERNAL_ATTRIBUTES = (0o100644 << 16) >>> 0;

/**
 * The DOS date of every entry, 1980-01-01, with the time 00:00. Fixed, so an
 * archive of the same entries is the same bytes whenever it is written
 * (REQ-STOR-103).
 */
export const FIXED_DOS_DATE = (0 << 9) | (1 << 5) | 1;

/** A 32-bit field that says its value is in the ZIP64 record or extra field. */
export const SENTINEL_32 = 0xffffffff;

/** A 16-bit field that says its value is in the ZIP64 end record. */
export const SENTINEL_16 = 0xffff;

/**
 * The largest values the writer still writes in the plain fields. One below
 * each sentinel: a value equal to the sentinel must be written as ZIP64 too,
 * or a reader would take it for the sentinel.
 */
export const PLAIN_LIMITS = {
  largestField: SENTINEL_32 - 1,
  largestCount: SENTINEL_16 - 1,
} as const;

/** How many bytes of an entry are read or written at a time: 1 MiB. */
export const ZIP_CHUNK_BYTES = 1_048_576;

/** The longest comment an end record may carry, which bounds the search for it. */
export const LONGEST_COMMENT = 0xffff;

/** Writes little-endian fields into a record, in order. */
export class FieldWriter {
  readonly bytes: Uint8Array<ArrayBuffer>;
  private readonly view: DataView<ArrayBuffer>;
  private offset = 0;

  constructor(length: number) {
    this.bytes = new Uint8Array(length);
    this.view = new DataView(this.bytes.buffer);
  }

  u16(value: number): this {
    this.view.setUint16(this.offset, value, true);
    this.offset += 2;
    return this;
  }

  u32(value: number): this {
    this.view.setUint32(this.offset, value, true);
    this.offset += 4;
    return this;
  }

  /** A 64-bit field of a value no larger than `Number.MAX_SAFE_INTEGER`. */
  u64(value: number): this {
    this.view.setBigUint64(this.offset, BigInt(value), true);
    this.offset += 8;
    return this;
  }

  raw(bytes: Uint8Array): this {
    this.bytes.set(bytes, this.offset);
    this.offset += bytes.length;
    return this;
  }

  /** The record, which must have been filled to its length exactly. */
  done(): Uint8Array<ArrayBuffer> {
    if (this.offset !== this.bytes.length) {
      throw new Error(
        `A record of ${String(this.bytes.length)} bytes was filled to ${String(this.offset)}.`,
      );
    }
    return this.bytes;
  }
}

/** Reads little-endian fields from bytes the caller has checked are long enough. */
export class FieldReader {
  private readonly view: DataView;

  constructor(bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  u16(offset: number): number {
    return this.view.getUint16(offset, true);
  }

  u32(offset: number): number {
    return this.view.getUint32(offset, true);
  }

  /**
   * A 64-bit field, or `undefined` where the value is past
   * `Number.MAX_SAFE_INTEGER` and so cannot be a size or offset of anything
   * this package can address.
   */
  u64(offset: number): number | undefined {
    const value = this.view.getBigUint64(offset, true);
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : undefined;
  }
}
