import { createHash } from 'node:crypto';
import { crc32 as zlibCrc32 } from 'node:zlib';

import { describe, expect, it, vi } from 'vitest';

import { FailureKind } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import { PYTHON, pythonReads } from './testing/python-zip.js';
import { immediateTurns } from './testing/host-turns.js';
import { contentOf, opened, patternBytes, spySource, zipOf } from './testing/zip-archives.js';
import { openZip } from './zip-reading.js';

/*
 * ZIP64 is needed from 4 GiB or 65,535 entries, which no unit test should
 * write. The plain fields' limits are lowered here instead, to 100 bytes and 3
 * entries, so the writer takes the ZIP64 path for small archives. The
 * sentinels and the layout are the format's, and are not lowered, so what is
 * written is real ZIP64 that any reader must accept.
 */
const LIMITS = vi.hoisted(() => ({ largestField: 100, largestCount: 3 }));

vi.mock(import('./zip-records.js'), async (importOriginal) => ({
  ...(await importOriginal()),
  PLAIN_LIMITS: LIMITS,
}));

const ENTRIES = [
  { path: 'small', source: patternBytes(10, 1) },
  { path: 'large', source: patternBytes(150, 2) },
  { path: 'late', source: patternBytes(10, 3) },
  { path: 'last', source: new Uint8Array(0) },
];

const ARCHIVE = await zipOf(ENTRIES);

/**
 * Where each record lies, worked out by hand from the format: `large` has
 * ZIP64 sizes, `late` and `last` start past 100 bytes and so have a ZIP64
 * offset, and the directory's count, size and offset each need the ZIP64 end
 * record.
 */
const At = {
  smallLocal: 0,
  largeLocal: 61,
  largeDescriptor: 266,
  lateLocal: 290,
  lastLocal: 350,
  directory: 400,
  largeCentral: 451,
  lateCentral: 522,
  zip64End: 646,
  locator: 702,
  end: 722,
} as const;

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function u64(bytes: Uint8Array, offset: number): number {
  return Number(view(bytes).getBigUint64(offset, true));
}

/** A copy of the archive changed by `edit`. */
function mutated(edit: (fields: DataView) => void): Uint8Array<ArrayBuffer> {
  const copy = ARCHIVE.slice();
  edit(new DataView(copy.buffer));
  return copy;
}

async function openRefusal(bytes: Uint8Array): Promise<readonly [string, string]> {
  const result = await openZip(spySource(bytes), { yieldToHost: immediateTurns });
  return [expectFailureCode(result), result.ok ? '' : result.failures[0].kind];
}

describe('writeZip: ZIP64 records', () => {
  it('writes a ZIP64 extra field of zero sizes and a 64-bit descriptor for a large entry', () => {
    const fields = view(ARCHIVE);
    expect(fields.getUint32(At.largeLocal, true)).toBe(0x04034b50);
    expect(fields.getUint16(At.largeLocal + 4, true)).toBe(45);
    expect(fields.getUint32(At.largeLocal + 18, true)).toBe(0xffffffff);
    expect(fields.getUint32(At.largeLocal + 22, true)).toBe(0xffffffff);
    expect(fields.getUint16(At.largeLocal + 28, true)).toBe(20);
    const extra = At.largeLocal + 35;
    expect([fields.getUint16(extra, true), fields.getUint16(extra + 2, true)]).toEqual([1, 16]);
    expect([u64(ARCHIVE, extra + 4), u64(ARCHIVE, extra + 12)]).toEqual([0, 0]);

    expect(fields.getUint32(At.largeDescriptor, true)).toBe(0x08074b50);
    expect(fields.getUint32(At.largeDescriptor + 4, true)).toBe(
      zlibCrc32(ENTRIES[1]?.source ?? new Uint8Array(1)),
    );
    expect(u64(ARCHIVE, At.largeDescriptor + 8)).toBe(150);
    expect(u64(ARCHIVE, At.largeDescriptor + 16)).toBe(150);
  });

  it('writes plain records where nothing is too large, with the version ZIP64 needs past an offset', () => {
    const fields = view(ARCHIVE);
    expect(fields.getUint16(At.smallLocal + 4, true)).toBe(20);
    expect(fields.getUint16(At.lateLocal + 4, true)).toBe(45);
    expect(fields.getUint16(At.lateLocal + 28, true)).toBe(0);
    expect(fields.getUint32(At.lastLocal - 16, true)).toBe(0x08074b50);
    expect(fields.getUint32(At.lastLocal, true)).toBe(0x04034b50);
  });

  it('writes the ZIP64 sizes and offsets in the central directory, only where needed', () => {
    const fields = view(ARCHIVE);
    expect(fields.getUint32(At.directory, true)).toBe(0x02014b50);
    expect(fields.getUint16(At.directory + 30, true)).toBe(0);

    expect(fields.getUint16(At.largeCentral + 6, true)).toBe(45);
    expect(fields.getUint32(At.largeCentral + 20, true)).toBe(0xffffffff);
    expect(fields.getUint32(At.largeCentral + 24, true)).toBe(0xffffffff);
    expect(fields.getUint32(At.largeCentral + 42, true)).toBe(At.largeLocal);
    const largeExtra = At.largeCentral + 51;
    expect([fields.getUint16(largeExtra, true), fields.getUint16(largeExtra + 2, true)]).toEqual([
      1, 16,
    ]);
    expect([u64(ARCHIVE, largeExtra + 4), u64(ARCHIVE, largeExtra + 12)]).toEqual([150, 150]);

    expect(fields.getUint32(At.lateCentral + 24, true)).toBe(10);
    expect(fields.getUint32(At.lateCentral + 42, true)).toBe(0xffffffff);
    const lateExtra = At.lateCentral + 50;
    expect([fields.getUint16(lateExtra, true), fields.getUint16(lateExtra + 2, true)]).toEqual([
      1, 8,
    ]);
    expect(u64(ARCHIVE, lateExtra + 4)).toBe(At.lateLocal);
  });

  it('writes the ZIP64 end record and locator, and sentinels in the end record', () => {
    const fields = view(ARCHIVE);
    expect(fields.getUint32(At.zip64End, true)).toBe(0x06064b50);
    expect(u64(ARCHIVE, At.zip64End + 4)).toBe(44);
    expect(fields.getUint16(At.zip64End + 14, true)).toBe(45);
    expect([u64(ARCHIVE, At.zip64End + 24), u64(ARCHIVE, At.zip64End + 32)]).toEqual([4, 4]);
    expect(u64(ARCHIVE, At.zip64End + 40)).toBe(At.zip64End - At.directory);
    expect(u64(ARCHIVE, At.zip64End + 48)).toBe(At.directory);

    expect(fields.getUint32(At.locator, true)).toBe(0x07064b50);
    expect(u64(ARCHIVE, At.locator + 8)).toBe(At.zip64End);
    expect(fields.getUint32(At.locator + 16, true)).toBe(1);

    expect(fields.getUint32(At.end, true)).toBe(0x06054b50);
    expect([fields.getUint16(At.end + 8, true), fields.getUint16(At.end + 10, true)]).toEqual([
      0xffff, 0xffff,
    ]);
    expect(fields.getUint32(At.end + 12, true)).toBe(0xffffffff);
    expect(fields.getUint32(At.end + 16, true)).toBe(0xffffffff);
    expect(ARCHIVE.length).toBe(At.end + 22);
  });

  it('writes the ZIP64 end record for the count alone, with sentinels only where needed', async () => {
    LIMITS.largestField = 1_000_000;
    try {
      const bytes = await zipOf(
        ['a', 'b', 'c', 'd'].map((path) => ({ path, source: new Uint8Array(1) })),
      );
      const fields = view(bytes);
      const end = bytes.length - 22;
      const directory = 4 * (30 + 1 + 1 + 16);
      expect(fields.getUint32(end - 20, true)).toBe(0x07064b50);
      expect(fields.getUint32(end - 76, true)).toBe(0x06064b50);
      expect(u64(bytes, end - 76 + 32)).toBe(4);
      expect([fields.getUint16(end + 8, true), fields.getUint16(end + 10, true)]).toEqual([
        0xffff, 0xffff,
      ]);
      expect(fields.getUint32(end + 12, true)).toBe(4 * (46 + 1));
      expect(fields.getUint32(end + 16, true)).toBe(directory);
      expect((await opened(bytes)).entries.map((entry) => entry.path)).toEqual([
        'a',
        'b',
        'c',
        'd',
      ]);
    } finally {
      LIMITS.largestField = 100;
    }
  });

  it('reads back what it wrote', async () => {
    const archive = await opened(ARCHIVE);
    expect(archive.entries.map(({ path, size }) => [path, size])).toEqual(
      ENTRIES.map(({ path, source }) => [path, source.length]),
    );
    for (const [index, entry] of archive.entries.entries()) {
      expect(await contentOf(entry)).toEqual(ENTRIES[index]?.source);
    }
  });

  // Skipped, and reported as skipped, where no Python is installed.
  it.skipIf(PYTHON === undefined)('writes ZIP64 that Python reads, every CRC right', () => {
    const listing = pythonReads(ARCHIVE);
    expect(listing.bad).toBeNull();
    expect(listing.entries).toEqual(
      ENTRIES.map(({ path, source }) => ({
        name: path,
        size: source.length,
        crc: zlibCrc32(source),
        method: 0,
        sha256: createHash('sha256').update(source).digest('hex'),
      })),
    );
  });
});

describe('openZip: ZIP64 refusals', () => {
  it('refuses a size past the largest safe integer', async () => {
    const bytes = mutated((fields) => {
      fields.setBigUint64(At.largeCentral + 55, 2n ** 60n, true);
    });
    expect(await openRefusal(bytes)).toEqual(['zip.size-unrepresentable', FailureKind.Rejected]);
  });

  it.each([
    ['a block that runs past the extra field', 40],
    ['a ZIP64 block too short for its sentinels', 8],
  ])('refuses an extra field with %s', async (_, length) => {
    const bytes = mutated((fields) => {
      fields.setUint16(At.largeCentral + 53, length, true);
    });
    expect(await openRefusal(bytes)).toEqual([
      'zip.extra-malformed',
      FailureKind.IntegrityViolation,
    ]);
  });

  it('refuses a header with two ZIP64 extra fields, even two that agree', async () => {
    // The last record's extra field ends the directory, so a second copy of
    // its ZIP64 block is inserted there, and the directory's size and the
    // end records after it moved along.
    const repeated = new Uint8Array(12);
    const block = new DataView(repeated.buffer);
    block.setUint16(0, 1, true);
    block.setUint16(2, 8, true);
    block.setBigUint64(4, BigInt(At.lastLocal), true);
    const bytes = new Uint8Array(ARCHIVE.length + 12);
    bytes.set(ARCHIVE.subarray(0, At.zip64End));
    bytes.set(repeated, At.zip64End);
    bytes.set(ARCHIVE.subarray(At.zip64End), At.zip64End + 12);
    const fields = view(bytes);
    const lastCentral = At.lateCentral + 62;
    fields.setUint16(lastCentral + 30, 24, true);
    fields.setBigUint64(At.zip64End + 12 + 40, BigInt(At.zip64End + 12 - At.directory), true);
    fields.setBigUint64(At.locator + 12 + 8, BigInt(At.zip64End + 12), true);

    expect(await openRefusal(bytes)).toEqual([
      'zip.extra-malformed',
      FailureKind.IntegrityViolation,
    ]);
  });

  it.each([
    ['a locator that points elsewhere', At.locator + 8, 'u64', At.zip64End - 1],
    ['a ZIP64 end record without its signature', At.zip64End, 'u32', 0],
    ['a ZIP64 end record of the wrong length', At.zip64End + 4, 'u64', 45],
    ['an end record count that disagrees', At.end + 10, 'u16', 5],
    ['an end record offset that disagrees', At.end + 16, 'u32', 7],
    ['a count past the largest safe integer', At.zip64End + 32, 'u64', 2 ** 60],
  ] as const)('refuses %s', async (_, offset, width, value) => {
    const bytes = mutated((fields) => {
      if (width === 'u64') fields.setBigUint64(offset, BigInt(value), true);
      else if (width === 'u32') fields.setUint32(offset, value, true);
      else fields.setUint16(offset, value, true);
    });
    expect(await openRefusal(bytes)).toEqual([
      'zip.end-record-malformed',
      FailureKind.IntegrityViolation,
    ]);
  });

  it.each([
    ['a locator on another disk', At.locator + 4, 1],
    ['a locator counting two disks', At.locator + 16, 2],
    ['a ZIP64 end record on another disk', At.zip64End + 16, 1],
    ['a directory on another disk', At.zip64End + 20, 1],
  ])('refuses a split archive: %s', async (_, offset, value) => {
    const bytes = mutated((fields) => {
      fields.setUint32(offset, value, true);
    });
    expect(await openRefusal(bytes)).toEqual(['zip.multi-disk', FailureKind.Rejected]);
  });

  it('refuses a split archive with fewer entries on this disk than in all', async () => {
    const bytes = mutated((fields) => {
      fields.setBigUint64(At.zip64End + 24, 3n, true);
    });
    expect(await openRefusal(bytes)).toEqual(['zip.multi-disk', FailureKind.Rejected]);
  });

  it('holds the ZIP64 count to the limit', async () => {
    const result = await openZip(spySource(ARCHIVE), {
      yieldToHost: immediateTurns,
      limits: { maxEntries: 3 },
    });
    expect(expectFailureCode(result)).toBe('zip.too-many-entries');
    expectSuccess(
      await openZip(spySource(ARCHIVE), { yieldToHost: immediateTurns, limits: { maxEntries: 4 } }),
    );
  });

  it('refuses a ZIP64 directory offset that does not add up', async () => {
    const bytes = mutated((fields) => {
      fields.setBigUint64(At.zip64End + 48, BigInt(At.directory + 1), true);
    });
    expect(await openRefusal(bytes)).toEqual([
      'zip.directory-misplaced',
      FailureKind.IntegrityViolation,
    ]);
  });
});
