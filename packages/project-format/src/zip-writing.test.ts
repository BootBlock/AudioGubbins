import { crc32 as zlibCrc32 } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { FailureKind } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import type { ByteSource } from './byte-ports.js';
import { immediateTurns } from './testing/host-turns.js';
import {
  contentOf,
  memorySink,
  opened,
  patternBytes,
  spySource,
  zipOf,
} from './testing/zip-archives.js';
import { encodeUtf8 } from './utf8.js';
import { writeZip, type ZipEntryInput } from './zip-writing.js';

const MIB = 1_048_576;

/** A view of an archive's little-endian fields. */
function fieldsOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** The entries as an asynchronous stream, as a caller building a bundle hands them over. */
async function* streamed(entries: readonly ZipEntryInput[]): AsyncGenerator<ZipEntryInput> {
  for (const entry of entries) {
    await Promise.resolve();
    yield entry;
  }
}

describe('writeZip: the records it writes', () => {
  it('writes an empty archive as an end record alone', async () => {
    const bytes = await zipOf([]);
    expect(Array.from(bytes)).toEqual([0x50, 0x4b, 0x05, 0x06, ...new Array<number>(18).fill(0)]);
  });

  it('writes a stored entry with a data descriptor, a UTF-8 name and the fixed date', async () => {
    const data = encodeUtf8('hello, world');
    const bytes = await zipOf([{ path: 'a.txt', source: data }]);
    const view = fieldsOf(bytes);
    const crc = zlibCrc32(data);

    // The local header, whose CRC and sizes wait for the descriptor.
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(4, true)).toBe(20);
    expect(view.getUint16(6, true)).toBe(0x0808);
    expect(view.getUint16(8, true)).toBe(0);
    expect(view.getUint16(10, true)).toBe(0);
    expect(view.getUint16(12, true)).toBe(0x0021);
    expect([view.getUint32(14, true), view.getUint32(18, true), view.getUint32(22, true)]).toEqual([
      0, 0, 0,
    ]);
    expect([view.getUint16(26, true), view.getUint16(28, true)]).toEqual([5, 0]);
    expect(bytes.subarray(35, 35 + data.length)).toEqual(data);

    const descriptor = 35 + data.length;
    expect(view.getUint32(descriptor, true)).toBe(0x08074b50);
    expect(view.getUint32(descriptor + 4, true)).toBe(crc);
    expect(view.getUint32(descriptor + 8, true)).toBe(data.length);
    expect(view.getUint32(descriptor + 12, true)).toBe(data.length);

    const central = descriptor + 16;
    expect(view.getUint32(central, true)).toBe(0x02014b50);
    expect(view.getUint16(central + 4, true)).toBe(0x032d);
    expect(view.getUint16(central + 6, true)).toBe(20);
    expect(view.getUint16(central + 8, true)).toBe(0x0808);
    expect(view.getUint32(central + 16, true)).toBe(crc);
    expect(view.getUint32(central + 20, true)).toBe(data.length);
    expect(view.getUint32(central + 38, true)).toBe(0o100644 * 0x10000);
    expect(view.getUint32(central + 42, true)).toBe(0);

    const end = central + 46 + 5;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(1);
    expect(view.getUint32(end + 12, true)).toBe(51);
    expect(view.getUint32(end + 16, true)).toBe(central);
    expect(bytes.length).toBe(end + 22);
  });

  it('writes the same bytes for the same entries, however they are handed over', async () => {
    const entries = [
      { path: 'manifest.json', source: encodeUtf8('{}') },
      { path: 'media/one.wav', source: patternBytes(3 * MIB + 17, 2) },
      { path: 'Ünïcode/名前.txt', source: encodeUtf8('text') },
    ];
    const first = await zipOf(entries);
    const again = await zipOf(entries);
    const asSources = await zipOf(
      entries.map(({ path, source }) => ({ path, source: spySource(source) })),
    );
    const sink = memorySink();
    expectSuccess(await writeZip(streamed(entries), sink, { yieldToHost: immediateTurns }));

    expect(Buffer.compare(again, first)).toBe(0);
    expect(Buffer.compare(asSources, first)).toBe(0);
    expect(Buffer.compare(sink.bytes(), first)).toBe(0);
  });

  it('reads a large entry in chunks of at most 1 MiB, never asking for it whole', async () => {
    const size = 5 * MIB + 123;
    const source = spySource(patternBytes(size, 4));
    const sink = memorySink();
    expectSuccess(
      await writeZip([{ path: 'long.wav', source }], sink, { yieldToHost: immediateTurns }),
    );

    expect(source.reads.every(({ length }) => length <= MIB)).toBe(true);
    expect(source.reads.map(({ offset }) => offset)).toEqual(
      [0, 1, 2, 3, 4, 5].map((n) => n * MIB),
    );
    expect(source.reads.reduce((total, { length }) => total + length, 0)).toBe(size);
    expect(sink.chunks.every((chunk) => chunk.length <= MIB)).toBe(true);
  });

  it('yields to the host between chunks, and reports the bytes written', async () => {
    const events: string[] = [];
    const bytes = patternBytes(3 * MIB, 5);
    const source: ByteSource = {
      size: bytes.length,
      read: (offset, length) => {
        events.push('read');
        return Promise.resolve(bytes.slice(offset, offset + length));
      },
    };
    const progress: number[] = [];
    const sink = memorySink();
    const written = expectSuccess(
      await writeZip([{ path: 'a.wav', source }], sink, {
        yieldToHost: () => {
          events.push('yield');
          return Promise.resolve();
        },
        onProgress: (count) => progress.push(count),
      }),
    );

    expect(events).toEqual(['read', 'yield', 'read', 'yield', 'read', 'yield']);
    expect(progress).toEqual(progress.toSorted((one, other) => one - other));
    expect(progress.at(-1)).toBe(sink.bytes().length);
    expect(written).toEqual({ entries: 1, bytes: sink.bytes().length });
  });
});

describe('writeZip: the names it accepts', () => {
  it.each([
    'manifest.json',
    'media/c1-0123.wav',
    '.hidden/file',
    'a b/c-d_e.f',
    'Ünïcode/名前/🎵.txt',
    'x'.repeat(65_535),
  ])('accepts %j', async (path) => {
    const archive = await opened(await zipOf([{ path, source: new Uint8Array(1) }]));
    expect(archive.entries.map((entry) => entry.path)).toEqual([path]);
  });

  it.each([
    ['empty', ''],
    ['absolute', '/etc/passwd'],
    ['an empty segment', 'a//b'],
    ['a trailing slash', 'a/'],
    ['a dot segment', './a'],
    ['a parent segment', 'a/../../b'],
    ['only a parent', '..'],
    ['a backslash', 'a\\b'],
    ['a drive letter', 'C:/Windows'],
    ['a colon', 'a:b'],
    ['a NUL', 'a\u0000b'],
    ['a line feed', 'a\nb'],
    ['a delete', 'a\u007f'],
    ['a C1 control', 'a\u0085'],
    ['a lone surrogate', 'a\ud800'],
    ['a name past 65,535 bytes', 'é'.repeat(32_768)],
  ])('refuses a name with %s, abandoning the sink', async (_, path) => {
    const sink = memorySink();
    const result = await writeZip(
      [
        { path: 'first', source: new Uint8Array(1) },
        { path, source: new Uint8Array(1) },
      ],
      sink,
      { yieldToHost: immediateTurns },
    );
    expect(expectFailureCode(result)).toBe('zip.unsafe-path');
    expect(result.ok || result.failures[0].kind).toBe(FailureKind.Rejected);
    expect(sink.ending.state).toBe('aborted');
  });

  it('refuses a name given twice', async () => {
    const sink = memorySink();
    const result = await writeZip(
      [
        { path: 'a/b', source: new Uint8Array(1) },
        { path: 'a/b', source: new Uint8Array(2) },
      ],
      sink,
      { yieldToHost: immediateTurns },
    );
    expect(expectFailureCode(result)).toBe('zip.duplicate-path');
    expect(sink.ending.state).toBe('aborted');
  });

  it.each([
    ['a file, then a name inside it', ['a', 'a/b']],
    ['a name inside a folder, then the folder as a file', ['a/b/c', 'a/b']],
  ])('refuses %s', async (_, paths) => {
    const sink = memorySink();
    const result = await writeZip(
      paths.map((path) => ({ path, source: new Uint8Array(0) })),
      sink,
      { yieldToHost: immediateTurns },
    );
    expect(expectFailureCode(result)).toBe('zip.file-and-folder');
    expect(sink.ending.state).toBe('aborted');
  });
});

describe('writeZip: failure', () => {
  it('fails with zip.short-read when a source returns fewer bytes than asked for', async () => {
    const sink = memorySink();
    const source: ByteSource = {
      size: 10,
      read: () => Promise.resolve(new Uint8Array(4)),
    };
    const result = await writeZip([{ path: 'a', source }], sink, { yieldToHost: immediateTurns });
    expect(expectFailureCode(result)).toBe('zip.short-read');
    expect(result.ok || result.failures[0].kind).toBe(FailureKind.IntegrityViolation);
    expect(sink.ending.state).toBe('aborted');
  });

  it('rejects with the reason when aborted mid-entry, abandoning the sink', async () => {
    const controller = new AbortController();
    const reason = new Error('The user cancelled.');
    const bytes = patternBytes(3 * MIB);
    const source: ByteSource = {
      size: bytes.length,
      read: (offset, length) => {
        if (offset > 0) controller.abort(reason);
        return Promise.resolve(bytes.slice(offset, offset + length));
      },
    };
    const sink = memorySink();
    await expect(
      writeZip([{ path: 'a', source }], sink, {
        yieldToHost: immediateTurns,
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(sink.ending).toEqual({ state: 'aborted', reason });
  });

  it('rejects with the error of a source, of the entries and of the sink, abandoning it', async () => {
    const broken = new Error('The file vanished.');
    const failingSource: ByteSource = { size: 5, read: () => Promise.reject(broken) };
    const sink = memorySink();
    await expect(
      writeZip([{ path: 'a', source: failingSource }], sink, { yieldToHost: immediateTurns }),
    ).rejects.toBe(broken);
    expect(sink.ending).toEqual({ state: 'aborted', reason: broken });

    async function* failingEntries(): AsyncGenerator<ZipEntryInput> {
      yield { path: 'a', source: new Uint8Array(1) };
      await Promise.resolve();
      throw broken;
    }
    const second = memorySink();
    await expect(writeZip(failingEntries(), second, { yieldToHost: immediateTurns })).rejects.toBe(
      broken,
    );
    expect(second.ending.state).toBe('aborted');

    const refusing = memorySink();
    const writes = { count: 0 };
    const third = {
      ...refusing,
      write: async (chunk: Uint8Array) => {
        writes.count += 1;
        if (writes.count === 2) throw broken;
        await refusing.write(chunk);
      },
    };
    await expect(
      writeZip([{ path: 'a', source: new Uint8Array(3) }], third, { yieldToHost: immediateTurns }),
    ).rejects.toBe(broken);
    expect(refusing.ending.state).toBe('aborted');
  });

  it('writes nothing more once the signal has aborted before it starts', async () => {
    const controller = new AbortController();
    controller.abort(new Error('Too late.'));
    const sink = memorySink();
    await expect(
      writeZip([{ path: 'a', source: new Uint8Array(1) }], sink, {
        yieldToHost: immediateTurns,
        signal: controller.signal,
      }),
    ).rejects.toThrow('Too late.');
    expect(sink.chunks).toEqual([]);
    expect(sink.ending.state).toBe('aborted');
  });

  it('throws on a source whose size is not a whole number of bytes', async () => {
    const source: ByteSource = { size: 1.5, read: () => Promise.resolve(new Uint8Array(0)) };
    await expect(
      writeZip([{ path: 'a', source }], memorySink(), { yieldToHost: immediateTurns }),
    ).rejects.toThrow(RangeError);
  });
});

describe('writeZip then openZip', () => {
  it('reads back what was written', async () => {
    const entries = [
      { path: 'empty', source: new Uint8Array(0) },
      { path: 'one', source: patternBytes(1, 9) },
      { path: 'deep/er/still', source: patternBytes(MIB - 1, 10) },
    ];
    const archive = await opened(await zipOf(entries));
    expect(archive.entries.map(({ path, size }) => ({ path, size }))).toEqual(
      entries.map(({ path, source }) => ({ path, size: source.length })),
    );
    for (const [index, entry] of archive.entries.entries()) {
      expect(
        Buffer.compare(await contentOf(entry), entries[index]?.source ?? new Uint8Array(1)),
      ).toBe(0);
    }
  });
});
