import { createHash } from 'node:crypto';
import { crc32 as zlibCrc32 } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { expectFailureCode } from '@audiogubbins/domain/testing';

import {
  PYTHON,
  pythonPattern,
  pythonReads,
  pythonWrites,
  type PythonArchive,
} from './testing/python-zip.js';
import { immediateTurns } from './testing/host-turns.js';
import { contentOf, opened, patternBytes, spySource, zipOf } from './testing/zip-archives.js';
import { encodeUtf8 } from './utf8.js';
import { openZip } from './zip-reading.js';

const MIB = 1_048_576;

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// Python is not part of the repository's toolchain: where it is absent these
// tests are reported as skipped, and every other ZIP test runs without it.
describe.skipIf(PYTHON === undefined)('ZIP interoperability with Python’s zipfile', () => {
  it('writes archives Python reads, every CRC right', async () => {
    const entries = [
      { path: 'manifest.json', source: encodeUtf8('{"format":1}') },
      { path: 'empty', source: new Uint8Array(0) },
      { path: 'media/Ünïcode 名前 🎵.wav', source: patternBytes(3 * MIB + 7, 1) },
      { path: 'deep/er/still.txt', source: encodeUtf8('text') },
    ];
    const listing = pythonReads(await zipOf(entries));

    expect(listing.bad).toBeNull();
    expect(listing.entries).toEqual(
      entries.map(({ path, source }) => ({
        name: path,
        size: source.length,
        crc: zlibCrc32(source),
        method: 0,
        sha256: sha256(source),
      })),
    );
  });

  it.each<PythonArchive>(['stored', 'streamed', 'zip64'])(
    'reads what Python writes %s',
    async (kind) => {
      const size = 2 * MIB + 3;
      const archive = await opened(pythonWrites(kind, size));
      expect(archive.entries.map(({ path, size: length }) => [path, length])).toEqual([
        ['folder/名前.txt', 4],
        ['empty', 0],
        ['big.bin', size],
      ]);
      const [named, empty, big] = archive.entries;
      expect(named && (await contentOf(named))).toEqual(encodeUtf8('text'));
      expect(empty && (await contentOf(empty))).toEqual(new Uint8Array(0));
      expect(big && sha256(await contentOf(big))).toBe(sha256(pythonPattern(size)));
    },
  );

  it('refuses what Python compresses, naming the method', async () => {
    const result = await openZip(spySource(pythonWrites('deflated', 10)), {
      yieldToHost: immediateTurns,
    });
    expect(expectFailureCode(result)).toBe('zip.compressed');
    expect(result.ok || result.failures[0].details).toEqual({ method: 8 });
  });
});
