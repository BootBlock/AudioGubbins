/**
 * Python's `zipfile`, an implementation of ZIP independent of this package,
 * for the interoperability tests: it reads the archives this package writes,
 * and writes archives for this package to read.
 *
 * Python is not a dependency of the repository. Where no interpreter with
 * `zipfile` is installed, {@link PYTHON} is `undefined` and the tests that
 * need it are skipped, saying so; no other test depends on it.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The command that runs a Python with `zipfile`, or `undefined` where there is none. */
export const PYTHON: string | undefined = ['python3', 'python', 'py'].find(
  (command) => spawnSync(command, ['-c', 'import zipfile'], { stdio: 'ignore' }).status === 0,
);

/** What Python found in an archive, entry by entry. */
export interface PythonListing {
  /** The first entry whose CRC-32 Python found wrong, or `null` when all are right. */
  readonly bad: string | null;
  readonly entries: readonly {
    readonly name: string;
    readonly size: number;
    readonly crc: number;
    readonly method: number;
    readonly sha256: string;
  }[];
}

/** How Python writes the archive of {@link pythonWrites}. */
export type PythonArchive = 'stored' | 'streamed' | 'zip64' | 'deflated';

const LIST = `
import hashlib, json, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as archive:
    bad = archive.testzip()
    entries = [
        {"name": info.filename, "size": info.file_size, "crc": info.CRC,
         "method": info.compress_type,
         "sha256": hashlib.sha256(archive.read(info)).hexdigest()}
        for info in archive.infolist()
    ]
print(json.dumps({"bad": bad, "entries": entries}))
`;

const WRITE = `
import sys, zipfile
path, kind = sys.argv[1], sys.argv[2]

class Unseekable:
    """A stream Python cannot seek, so it writes data descriptors."""
    def __init__(self, stream): self.stream = stream
    def write(self, data): return self.stream.write(data)
    def flush(self): self.stream.flush()

method = zipfile.ZIP_DEFLATED if kind == "deflated" else zipfile.ZIP_STORED
with open(path, "wb") as file:
    target = Unseekable(file) if kind == "streamed" else file
    with zipfile.ZipFile(target, "w", compression=method) as archive:
        archive.writestr("folder/", b"")
        archive.writestr("folder/名前.txt", "text".encode())
        archive.writestr("empty", b"")
        data = bytes((index * 7) % 251 for index in range(int(sys.argv[3])))
        with archive.open("big.bin", "w", force_zip64=(kind == "zip64")) as entry:
            entry.write(data)
`;

/** Runs `script` with `args`, giving what it prints, and throwing with what it said when it fails. */
function runPython(script: string, args: readonly string[]): string {
  if (PYTHON === undefined) throw new Error('No Python with zipfile is installed.');
  const run = spawnSync(PYTHON, ['-c', script, ...args], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`Python failed: ${run.stderr}`);
  return run.stdout;
}

/** Runs `work` with a fresh temporary folder, removed afterwards. */
function inTemporaryFolder<TResult>(work: (folder: string) => TResult): TResult {
  const folder = mkdtempSync(join(tmpdir(), 'audiogubbins-zip-'));
  try {
    return work(folder);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/** What Python's `zipfile` reads in `bytes`, each entry's CRC checked. */
export function pythonReads(bytes: Uint8Array): PythonListing {
  return inTemporaryFolder((folder) => {
    const path = join(folder, 'archive.zip');
    writeFileSync(path, bytes);
    const listing: unknown = JSON.parse(runPython(LIST, [path]));
    if (!isListing(listing)) throw new Error('Python printed something other than a listing.');
    return listing;
  });
}

/** Whether `value` has the shape the listing script prints. */
function isListing(value: unknown): value is PythonListing {
  if (typeof value !== 'object' || value === null) return false;
  if (!('bad' in value) || !(value.bad === null || typeof value.bad === 'string')) return false;
  return (
    'entries' in value &&
    Array.isArray(value.entries) &&
    value.entries.every(
      (entry: unknown) =>
        typeof entry === 'object' &&
        entry !== null &&
        'name' in entry &&
        typeof entry.name === 'string' &&
        'size' in entry &&
        typeof entry.size === 'number' &&
        'crc' in entry &&
        typeof entry.crc === 'number' &&
        'method' in entry &&
        typeof entry.method === 'number' &&
        'sha256' in entry &&
        typeof entry.sha256 === 'string',
    )
  );
}

/**
 * An archive Python's `zipfile` writes: a folder listed on its own, a UTF-8
 * name, an empty entry and `big.bin` of `bigSize` bytes of
 * {@link pythonPattern}.
 */
export function pythonWrites(kind: PythonArchive, bigSize: number): Uint8Array<ArrayBuffer> {
  return inTemporaryFolder((folder) => {
    const path = join(folder, 'archive.zip');
    runPython(WRITE, [path, kind, String(bigSize)]);
    return new Uint8Array(readFileSync(path));
  });
}

/** The bytes Python writes as `big.bin`. */
export function pythonPattern(size: number): Uint8Array<ArrayBuffer> {
  return Uint8Array.from({ length: size }, (_, index) => (index * 7) % 251);
}
