import { describe, expect, it } from 'vitest';

import { FailureKind, type DomainResult } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import type { ByteSource } from './byte-ports.js';
import { contentOf, opened, patternBytes, spySource, zipOf } from './testing/zip-archives.js';
import { encodeUtf8 } from './utf8.js';
import { openZip, readVerified, type ZipArchive, type ZipEntry } from './zip-reading.js';

const MIB = 1_048_576;

/** Where the records of a plain archive this package wrote lie. */
interface Layout {
  readonly end: number;
  readonly directory: number;
  readonly central: readonly number[];
  readonly local: readonly number[];
}

/** The layout of a plain archive with no comment, read by the format's definition. */
function layoutOf(bytes: Uint8Array): Layout {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  const directory = view.getUint32(end + 16, true);
  const central: number[] = [];
  const local: number[] = [];
  let at = directory;
  for (let index = 0; index < view.getUint16(end + 10, true); index += 1) {
    central.push(at);
    local.push(view.getUint32(at + 42, true));
    at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true);
  }
  return { end, directory, central, local };
}

/** A copy of `bytes` changed by `edit`. */
function mutated(
  bytes: Uint8Array,
  edit: (view: DataView, copy: Uint8Array<ArrayBuffer>, layout: Layout) => void,
): Uint8Array<ArrayBuffer> {
  const copy = bytes.slice();
  edit(new DataView(copy.buffer), copy, layoutOf(bytes));
  return copy;
}

/** The item at `index` of `list`, which must be there. */
function at<TItem>(list: readonly TItem[], index: number): TItem {
  const item = list[index];
  if (item === undefined) throw new Error(`Nothing at ${String(index)}.`);
  return item;
}

/** The code and kind of the first failure of a result that must fail. */
function refusal<TValue>(result: DomainResult<TValue>): readonly [string, string] {
  const code = expectFailureCode(result);
  return [code, result.ok ? '' : result.failures[0].kind];
}

/** Opening `bytes`, as the code and kind it is refused with. */
async function openRefusal(bytes: Uint8Array): Promise<readonly [string, string]> {
  return refusal(await openZip(spySource(bytes)));
}

/** Opening the one entry of `bytes`, as the code and kind it is refused with. */
async function entryRefusal(bytes: Uint8Array): Promise<readonly [string, string]> {
  const archive = await opened(bytes);
  return refusal(await at(archive.entries, 0).open());
}

const ONE = await zipOf([{ path: 'abcd', source: encodeUtf8('some data') }]);
const TWO = await zipOf([
  { path: 'abcd', source: encodeUtf8('first') },
  { path: 'wxyz', source: encodeUtf8('second') },
]);

describe('openZip then readVerified: round trips', () => {
  it('opens an empty archive with no entries', async () => {
    expect((await opened(await zipOf([]))).entries).toEqual([]);
  });

  it('opens one empty entry', async () => {
    const archive = await opened(await zipOf([{ path: 'nothing', source: new Uint8Array(0) }]));
    const entry = at(archive.entries, 0);
    expect([entry.path, entry.size, entry.crc32]).toEqual(['nothing', 0, 0]);
    expect(await contentOf(entry)).toEqual(new Uint8Array(0));
  });

  it('opens many entries, in the order they were written', async () => {
    const entries = Array.from({ length: 300 }, (_, index) => ({
      path: `folder-${String(index % 7)}/entry-${String(index)}.bin`,
      source: patternBytes((index * 37) % 1_000, index),
    }));
    const archive = await opened(await zipOf(entries));
    expect(archive.entries.map((entry) => entry.path)).toEqual(entries.map((entry) => entry.path));
    for (const [index, entry] of archive.entries.entries()) {
      expect(Buffer.compare(await contentOf(entry), at(entries, index).source)).toBe(0);
    }
  });

  it('opens names in any script, and an astral character', async () => {
    const paths = ['Ünïcode/名前.txt', 'Ελληνικά/файл', '🎵/ноты.wav'];
    const archive = await opened(
      await zipOf(paths.map((path) => ({ path, source: encodeUtf8(path) }))),
    );
    expect(archive.entries.map((entry) => entry.path)).toEqual(paths);
    expect(await contentOf(at(archive.entries, 2))).toEqual(encodeUtf8('🎵/ноты.wav'));
  });

  it.each([MIB - 1, MIB, MIB + 1, 2 * MIB + 5])(
    'reads an entry of %i bytes across chunk boundaries',
    async (size) => {
      const data = patternBytes(size, size);
      const archive = await opened(
        await zipOf([
          { path: 'before', source: patternBytes(3, 1) },
          { path: 'entry', source: data },
          { path: 'after', source: patternBytes(5, 2) },
        ]),
      );
      expect(Buffer.compare(await contentOf(at(archive.entries, 1)), data)).toBe(0);
      expect(await contentOf(at(archive.entries, 2))).toEqual(patternBytes(5, 2));
    },
  );

  it('streams an entry of several MiB, never asking the archive for it whole', async () => {
    const size = 6 * MIB + 321;
    const bytes = await zipOf([{ path: 'long.wav', source: patternBytes(size, 11) }]);
    const source = spySource(bytes);
    const archive = expectSuccess(await openZip(source));
    const opening = source.reads.length;

    const lengths: number[] = [];
    expectSuccess(
      await readVerified(at(archive.entries, 0), (chunk) => {
        lengths.push(chunk.length);
        return Promise.resolve();
      }),
    );
    expect(source.reads.slice(0, opening).every(({ length }) => length <= 65_557)).toBe(true);
    expect(source.reads.every(({ length }) => length <= MIB)).toBe(true);
    expect(lengths.reduce((total, length) => total + length, 0)).toBe(size);
    expect(Math.max(...lengths)).toBe(MIB);
  });

  it('reads the end of the archive alone when opening it', async () => {
    const bytes = await zipOf([{ path: 'long', source: patternBytes(3 * MIB, 3) }]);
    const source = spySource(bytes);
    expectSuccess(await openZip(source));
    expect(source.reads.every(({ offset }) => offset >= bytes.length - 65_557)).toBe(true);
    expect(source.reads.every(({ length }) => length <= 65_557)).toBe(true);
  });

  it('opens an archive with a comment after its end record', async () => {
    const commented = new Uint8Array(ONE.length + 4);
    commented.set(ONE);
    commented.set(encodeUtf8('note'), ONE.length);
    new DataView(commented.buffer).setUint16(ONE.length - 2, 4, true);
    const archive = await opened(commented);
    expect(await contentOf(at(archive.entries, 0))).toEqual(encodeUtf8('some data'));
  });

  it('opens an ASCII name that is not flagged as UTF-8', async () => {
    const bytes = mutated(ONE, (view, _, layout) => {
      view.setUint16(at(layout.central, 0) + 8, 0x0008, true);
    });
    expect(at((await opened(bytes)).entries, 0).path).toBe('abcd');
  });

  it('opens a local header that carries its CRC and sizes, as another tool writes it', async () => {
    const bytes = mutated(ONE, (view) => {
      view.setUint16(6, 0x0800, true);
      view.setUint32(14, view.getUint32(ONE.length - 22 - 50 + 16, true), true);
      view.setUint32(18, 9, true);
      view.setUint32(22, 9, true);
    });
    const entry = at((await opened(bytes)).entries, 0);
    expect(await contentOf(entry)).toEqual(encodeUtf8('some data'));
  });

  it('skips a folder listed on its own, as other tools list one', async () => {
    const bytes = mutated(TWO, (_, copy, layout) => {
      copy.set(encodeUtf8('dir/'), at(layout.central, 1) + 46);
      copy.set(encodeUtf8('dir/'), at(layout.local, 1) + 30);
      const view = new DataView(copy.buffer);
      for (const field of [16, 20, 24]) view.setUint32(at(layout.central, 1) + field, 0, true);
    });
    const archive = await opened(bytes);
    expect(archive.entries.map((entry) => entry.path)).toEqual(['abcd']);
  });

  it('refuses a folder entry that holds data', async () => {
    const bytes = mutated(TWO, (_, copy, layout) => {
      copy.set(encodeUtf8('dir/'), at(layout.central, 1) + 46);
    });
    expect(await openRefusal(bytes)).toEqual([
      'zip.directory-malformed',
      FailureKind.IntegrityViolation,
    ]);
  });
});

describe('openZip: refusals', () => {
  it.each([
    ['an empty file', new Uint8Array(0)],
    ['bytes that are no archive', patternBytes(4_000, 4)],
    ['an archive cut short', ONE.subarray(0, ONE.length - 1)],
  ])('refuses %s as having no end record', async (_, bytes) => {
    expect(await openRefusal(bytes)).toEqual([
      'zip.end-record-missing',
      FailureKind.IntegrityViolation,
    ]);
  });

  it('refuses a compressed entry, naming its method', async () => {
    const bytes = mutated(ONE, (view, _, layout) => {
      view.setUint16(at(layout.central, 0) + 10, 8, true);
    });
    const result = await openZip(spySource(bytes));
    expect(refusal(result)).toEqual(['zip.compressed', FailureKind.Rejected]);
    expect(result.ok || result.failures[0].details).toEqual({ method: 8 });
    expect(result.ok || result.failures[0].summary).toContain('method 8');
  });

  it.each([
    ['traditional encryption', 0x0001],
    ['strong encryption', 0x0040],
    ['a masked directory', 0x2000],
  ])('refuses an entry flagged for %s', async (_, flag) => {
    const bytes = mutated(ONE, (view, _copy, layout) => {
      view.setUint16(at(layout.central, 0) + 8, 0x0808 | flag, true);
    });
    expect(await openRefusal(bytes)).toEqual(['zip.encrypted', FailureKind.Rejected]);
  });

  it.each([
    [
      'the end record on a second disk',
      (view: DataView, layout: Layout) => {
        view.setUint16(layout.end + 4, 1, true);
      },
    ],
    [
      'the directory on a second disk',
      (view: DataView, layout: Layout) => {
        view.setUint16(layout.end + 6, 1, true);
      },
    ],
    [
      'fewer entries on this disk than in all',
      (view: DataView, layout: Layout) => {
        view.setUint16(layout.end + 8, 0, true);
      },
    ],
    [
      'an entry on a second disk',
      (view: DataView, layout: Layout) => {
        view.setUint16(at(layout.central, 0) + 34, 1, true);
      },
    ],
  ])('refuses a split archive: %s', async (_, edit) => {
    const bytes = mutated(ONE, (view, _copy, layout) => {
      edit(view, layout);
    });
    expect(await openRefusal(bytes)).toEqual(['zip.multi-disk', FailureKind.Rejected]);
  });

  it('refuses two entries of the same name', async () => {
    const bytes = mutated(TWO, (_, copy, layout) => {
      copy.set(encodeUtf8('abcd'), at(layout.central, 1) + 46);
    });
    expect(await openRefusal(bytes)).toEqual([
      'zip.duplicate-path',
      FailureKind.IntegrityViolation,
    ]);
  });

  it('refuses a name that is a file and the folder of another', async () => {
    const written = await zipOf([
      { path: 'ab', source: encodeUtf8('first') },
      { path: 'xy/z', source: encodeUtf8('second') },
    ]);
    const bytes = mutated(written, (_, copy, layout) => {
      copy.set(encodeUtf8('ab'), at(layout.central, 1) + 46);
    });
    expect(await openRefusal(bytes)).toEqual([
      'zip.file-and-folder',
      FailureKind.IntegrityViolation,
    ]);
  });

  it.each([
    ['a parent segment', '../x'],
    ['an absolute path', '/etc'],
    ['a backslash', 'a\\bc'],
    ['a drive letter', 'C:/x'],
    ['a NUL', 'ab\u0000c'],
    ['a control character', 'ab\u001bc'],
    ['an empty segment', 'a//b'],
    ['a dot segment', 'a/./'],
  ])('refuses a name with %s', async (_, name) => {
    const bytes = mutated(ONE, (_view, copy, layout) => {
      copy.set(encodeUtf8(name), at(layout.central, 0) + 46);
    });
    expect(await openRefusal(bytes)).toEqual(['zip.unsafe-path', FailureKind.Rejected]);
  });

  it('refuses a name flagged as UTF-8 that is not', async () => {
    const bytes = mutated(ONE, (_view, copy, layout) => {
      copy[at(layout.central, 0) + 47] = 0xff;
    });
    expect(await openRefusal(bytes)).toEqual(['zip.name-not-utf8', FailureKind.IntegrityViolation]);
  });

  it('refuses a name neither flagged as UTF-8 nor printable ASCII', async () => {
    const bytes = mutated(
      await zipOf([{ path: 'é', source: new Uint8Array(1) }]),
      (view, _, layout) => {
        view.setUint16(at(layout.central, 0) + 8, 0x0008, true);
      },
    );
    expect(await openRefusal(bytes)).toEqual(['zip.name-not-ascii', FailureKind.Rejected]);
  });

  it('refuses more entries than the limit, and accepts as many', async () => {
    const three = await zipOf(['a', 'b', 'c'].map((path) => ({ path, source: new Uint8Array(1) })));
    expect(refusal(await openZip(spySource(three), { limits: { maxEntries: 2 } }))).toEqual([
      'zip.too-many-entries',
      FailureKind.Rejected,
    ]);
    expectSuccess(await openZip(spySource(three), { limits: { maxEntries: 3 } }));
  });

  it('refuses a directory larger than the limit before reading it', async () => {
    const source = spySource(TWO);
    const directorySize = TWO.length - 22 - layoutOf(TWO).directory;
    const result = await openZip(source, { limits: { maxDirectoryBytes: directorySize - 1 } });
    expect(refusal(result)).toEqual(['zip.directory-too-large', FailureKind.Rejected]);
    expect(source.reads).toEqual([{ offset: 0, length: TWO.length }]);
    expectSuccess(await openZip(spySource(TWO), { limits: { maxDirectoryBytes: directorySize } }));
  });

  it('refuses a stored entry whose two sizes differ', async () => {
    const bytes = mutated(ONE, (view, _, layout) => {
      view.setUint32(at(layout.central, 0) + 20, 10, true);
    });
    expect(await openRefusal(bytes)).toEqual(['zip.size-mismatch', FailureKind.IntegrityViolation]);
  });

  it('refuses entries that share bytes, as an archive built to unpack far larger does', async () => {
    const bytes = mutated(TWO, (view, _, layout) => {
      view.setUint32(at(layout.central, 1) + 42, 0, true);
    });
    expect(await openRefusal(bytes)).toEqual([
      'zip.overlapping-entries',
      FailureKind.IntegrityViolation,
    ]);
  });

  it('refuses an entry whose data reaches into the central directory', async () => {
    const bytes = mutated(ONE, (view, _, layout) => {
      for (const field of [20, 24]) view.setUint32(at(layout.central, 0) + field, 9 + 17, true);
    });
    expect(await openRefusal(bytes)).toEqual([
      'zip.overlapping-entries',
      FailureKind.IntegrityViolation,
    ]);
  });

  it.each([
    ['bytes before the archive', (bytes: Uint8Array) => Uint8Array.of(0, ...bytes)],
    [
      'a directory offset that is off by one',
      (bytes: Uint8Array) =>
        mutated(bytes, (view, _, layout) => {
          view.setUint32(layout.end + 16, layout.directory + 1, true);
        }),
    ],
    [
      'a count too large for the directory',
      (bytes: Uint8Array) =>
        mutated(bytes, (view, _, layout) => {
          view.setUint16(layout.end + 8, 9, true);
          view.setUint16(layout.end + 10, 9, true);
        }),
    ],
  ])('refuses %s, as a truncated or altered archive', async (_, damage) => {
    expect(await openRefusal(damage(ONE))).toEqual([
      'zip.directory-misplaced',
      FailureKind.IntegrityViolation,
    ]);
  });

  it('refuses a directory record without its signature, or with bytes past its count', async () => {
    const unsigned = mutated(TWO, (view, _, layout) => {
      view.setUint32(at(layout.central, 1), 0, true);
    });
    expect(await openRefusal(unsigned)).toEqual([
      'zip.directory-malformed',
      FailureKind.IntegrityViolation,
    ]);
    const undercounted = mutated(TWO, (view, _, layout) => {
      view.setUint16(layout.end + 8, 1, true);
      view.setUint16(layout.end + 10, 1, true);
    });
    expect(await openRefusal(undercounted)).toEqual([
      'zip.directory-malformed',
      FailureKind.IntegrityViolation,
    ]);
  });

  it('refuses a record whose name runs past the directory', async () => {
    const bytes = mutated(ONE, (view, _, layout) => {
      view.setUint16(at(layout.central, 0) + 28, 200, true);
    });
    expect(await openRefusal(bytes)).toEqual([
      'zip.directory-malformed',
      FailureKind.IntegrityViolation,
    ]);
  });

  it('refuses a ZIP64 sentinel with no extra field to answer it', async () => {
    const bytes = mutated(ONE, (view, _, layout) => {
      view.setUint32(at(layout.central, 0) + 42, 0xffffffff, true);
    });
    expect(await openRefusal(bytes)).toEqual([
      'zip.extra-malformed',
      FailureKind.IntegrityViolation,
    ]);
  });

  it('refuses a source that returns fewer bytes than asked for', async () => {
    const source: ByteSource = {
      size: ONE.length,
      read: (offset, length) => Promise.resolve(ONE.slice(offset, offset + length - 1)),
    };
    expect(refusal(await openZip(source))).toEqual([
      'zip.short-read',
      FailureKind.IntegrityViolation,
    ]);
  });

  it('rejects with the reason when the signal has aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('Cancelled.'));
    await expect(openZip(spySource(ONE), { signal: controller.signal })).rejects.toThrow(
      'Cancelled.',
    );
  });
});

describe('ZipEntry.open: the local header', () => {
  it('refuses a local header without its signature', async () => {
    const bytes = mutated(ONE, (view) => {
      view.setUint32(0, 0, true);
    });
    expect(await entryRefusal(bytes)).toEqual([
      'zip.local-header-mismatch',
      FailureKind.IntegrityViolation,
    ]);
  });

  it('refuses a local header that names a different file', async () => {
    const bytes = mutated(ONE, (_, copy) => {
      copy[30] = 0x7a;
    });
    expect(await entryRefusal(bytes)).toEqual([
      'zip.local-header-mismatch',
      FailureKind.IntegrityViolation,
    ]);
  });

  it.each([
    ['CRC', 14],
    ['compressed size', 18],
    ['size', 22],
  ])('refuses a local header whose %s disagrees with the directory', async (_, field) => {
    const bytes = mutated(ONE, (view) => {
      view.setUint32(field, 1, true);
    });
    expect(await entryRefusal(bytes)).toEqual([
      'zip.local-header-mismatch',
      FailureKind.IntegrityViolation,
    ]);
  });

  it('refuses a local header whose method or encryption the directory hides', async () => {
    const compressed = mutated(ONE, (view) => {
      view.setUint16(8, 8, true);
    });
    expect(await entryRefusal(compressed)).toEqual(['zip.compressed', FailureKind.Rejected]);
    const encrypted = mutated(ONE, (view) => {
      view.setUint16(6, 0x0809, true);
    });
    expect(await entryRefusal(encrypted)).toEqual(['zip.encrypted', FailureKind.Rejected]);
  });

  it('refuses a local extra field that pushes the data into the directory', async () => {
    const bytes = mutated(ONE, (view) => {
      view.setUint16(28, 17, true);
    });
    expect(await entryRefusal(bytes)).toEqual([
      'zip.overlapping-entries',
      FailureKind.IntegrityViolation,
    ]);
  });

  it('gives a source of the entry alone, refusing a read outside it', async () => {
    const entry = at((await opened(ONE)).entries, 0);
    const data = expectSuccess(await entry.open());
    expect(data.size).toBe(9);
    expect(await data.read(5, 4)).toEqual(encodeUtf8('data'));
    await expect(data.read(5, 5)).rejects.toThrow(RangeError);
  });
});

describe('readVerified', () => {
  /** The first entry of `bytes`, and every chunk read from it. */
  async function readFirst(
    bytes: Uint8Array,
  ): Promise<readonly [DomainResult<void>, readonly Uint8Array[]]> {
    const archive: ZipArchive = await opened(bytes);
    const entry: ZipEntry = at(archive.entries, 0);
    const chunks: Uint8Array[] = [];
    const result = await readVerified(entry, (chunk) => {
      chunks.push(chunk);
      return Promise.resolve();
    });
    return [result, chunks];
  }

  it('refuses data that does not match its CRC-32', async () => {
    const bytes = mutated(ONE, (_, copy) => {
      copy.set([(copy[37] ?? 0) ^ 0x01], 37);
    });
    const [result] = await readFirst(bytes);
    expect(refusal(result)).toEqual(['zip.crc-mismatch', FailureKind.IntegrityViolation]);
  });

  it('refuses data that changes while it is read', async () => {
    const size = 2 * MIB;
    const bytes = await zipOf([{ path: 'a', source: patternBytes(size, 6) }]);
    const changing = { shortened: false };
    const source: ByteSource = {
      size: bytes.length,
      read: (offset, length) =>
        Promise.resolve(bytes.slice(offset, offset + length - (changing.shortened ? 1 : 0))),
    };
    const archive = expectSuccess(await openZip(source));
    changing.shortened = true;
    const result = await readVerified(at(archive.entries, 0), () => Promise.resolve());
    expect(refusal(result)).toEqual(['zip.short-read', FailureKind.IntegrityViolation]);
  });

  it('yields to the host between chunks', async () => {
    const bytes = await zipOf([{ path: 'a', source: patternBytes(2 * MIB + 1, 8) }]);
    const events: string[] = [];
    expectSuccess(
      await readVerified(
        at((await opened(bytes)).entries, 0),
        () => {
          events.push('chunk');
          return Promise.resolve();
        },
        {
          yieldToHost: () => {
            events.push('yield');
            return Promise.resolve();
          },
        },
      ),
    );
    expect(events).toEqual(['chunk', 'yield', 'chunk', 'yield', 'chunk', 'yield']);
  });
});
