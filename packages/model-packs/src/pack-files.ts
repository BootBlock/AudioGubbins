/**
 * The files a pack names, as the manifest reader admits them: each a path that
 * stays inside its pack, a length and a SHA-256, and no two that one file
 * system would keep as one (ADR-0062).
 *
 * A path is held to the grammar of `pack-path.ts`, which the development
 * server serves files by too; one outside it is refused with the reason,
 * never with the path.
 */

import {
  integerConverter,
  listConverter,
  objectOf,
  pathOf,
  required,
  type Converter,
  type Reading,
} from '@audiogubbins/project-format';

import type { PackFile } from './manifest.js';
import { packFilePathProblem } from './pack-path.js';

/** The most files a pack may name. */
const MOST_FILES = 64;

/**
 * The longest file a pack may hold: 2 GiB. A model is read whole into memory
 * for the runtime to load, and no browser gives one buffer much more.
 */
const LONGEST_FILE_BYTES = 2 ** 31;

const SHA256_HEX = /^[0-9a-f]{64}$/u;

const FILE_MEMBERS: ReadonlySet<string> = new Set(['path', 'bytes', 'sha256']);

const asFileBytes = integerConverter(1, LONGEST_FILE_BYTES);

const asPath: Converter<string> = (reading, value, parent, key) => {
  if (typeof value !== 'string') {
    reading.refuse('schema.not-a-string', 'Text is expected here.', pathOf(parent, key));
    return undefined;
  }
  const problem = packFilePathProblem(value);
  if (problem === undefined) return value;
  reading.refuse('model-pack.path-unsafe', problem, pathOf(parent, key));
  return undefined;
};

const asSha256: Converter<string> = (reading, value, parent, key) => {
  if (typeof value === 'string' && SHA256_HEX.test(value)) return value;
  reading.refuse(
    'model-pack.hash-malformed',
    'A SHA-256 is 64 lower-case hexadecimal digits.',
    pathOf(parent, key),
  );
  return undefined;
};

const readFile: Converter<PackFile> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, FILE_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const path = required(reading, object, at, 'path', asPath);
  const bytes = required(reading, object, at, 'bytes', asFileBytes);
  const sha256 = required(reading, object, at, 'sha256', asSha256);
  return path === undefined || bytes === undefined || sha256 === undefined
    ? undefined
    : { path, bytes, sha256 };
};

/**
 * Refuses a file whose path is another's in another case, which one file system
 * would keep as one file, or a directory of another's, which no file system can
 * keep beside it.
 */
function refuseCollidingPaths(reading: Reading, files: readonly PackFile[], at: string): boolean {
  const folded = files.map((file) => file.path.toLowerCase());
  let clear = true;
  for (const [index, path] of folded.entries()) {
    const collides = folded.some(
      (other, otherIndex) =>
        otherIndex !== index &&
        ((otherIndex < index && other === path) || other.startsWith(`${path}/`)),
    );
    if (collides) {
      reading.refuse(
        'model-pack.path-collides',
        'Another file of the pack has this path, in any case, or lies inside it.',
        pathOf(pathOf(at, index), 'path'),
      );
      clear = false;
    }
  }
  return clear;
}

/** Reads the files of a pack: one at least, no two colliding. */
export const readFiles: Converter<readonly PackFile[]> = (reading, value, parent, key) => {
  const files = listConverter(MOST_FILES, readFile)(reading, value, parent, key);
  if (files === undefined) return undefined;
  const at = pathOf(parent, key);
  if (files.length === 0) {
    reading.refuse('model-pack.list-empty', 'A pack holds one file at least.', at);
    return undefined;
  }
  return refuseCollidingPaths(reading, files, at) ? files : undefined;
};
