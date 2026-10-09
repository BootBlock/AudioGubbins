/**
 * The grammar of the paths a pack's files are named and served by (ADR-0062):
 * a file's path inside its pack, a pack's name, and a path under the
 * catalogue's URL, which is the catalogue's own file or
 * `<id>/<version>/<file path>`.
 *
 * A file's path is fetched from the catalogue under the pack's directory,
 * matched against the files a person imports, and answered by the development
 * server from a folder on disk, so one that climbed out with `..`, began at a
 * root, a drive or a share, or used a backslash could name a file the pack
 * does not own: on Windows a backslash, a drive or `\\?\` names a place a
 * check of the joined path does not see as outside, and a share opens a
 * network connection. So each part is held to a closed alphabet instead.
 *
 * It imports nothing but the version grammar, which imports nothing, since
 * the build's configuration bundles it by its path: Node loads a package the
 * configuration imports by name without a compiler (the dependency cruise
 * holds both).
 */

import { PACK_VERSION } from './pack-version.js';

const LONGEST_PATH = 255;
const MOST_SEGMENTS = 8;

/** A path segment: letters, digits, `.`, `_` and `-`, not starting with a dot. */
const PATH_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/u;
const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:)/u;

/** A pack's name: lower-case letters, digits and inner hyphens. */
export const PACK_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;

/** The longest pack name, which {@link PACK_ID} already bounds. */
export const LONGEST_PACK_ID = 64;

/** The catalogue's file under the catalogue's URL. */
export const CATALOGUE_FILE = 'catalogue.json';

/** Why a path is not one a file of a pack may have, or `undefined` where it may. */
export function packFilePathProblem(path: string): string | undefined {
  if (path.includes('\\')) return 'A file path uses `/` between segments, never a backslash.';
  if (ABSOLUTE_PATH.test(path)) return 'A file path is relative to its pack, never absolute.';
  if (path.length > LONGEST_PATH) {
    return `A file path is at most ${String(LONGEST_PATH)} characters.`;
  }
  const segments = path.split('/');
  if (segments.length > MOST_SEGMENTS) {
    return `A file path has at most ${String(MOST_SEGMENTS)} segments.`;
  }
  if (segments.some((segment) => segment === '..')) {
    return 'A file path never climbs out of its pack with `..`.';
  }
  if (segments.some((segment) => segment === '' || segment === '.')) {
    return 'A file path has no empty or `.` segment.';
  }
  return segments.every((segment) => PATH_SEGMENT.test(segment))
    ? undefined
    : 'A file path segment is letters, digits, `.`, `_` and `-`, not starting with a dot.';
}

/**
 * Why a path below the catalogue's URL, decoded, names nothing the catalogue
 * serves, or `undefined` where it names the catalogue's file or a pack's file.
 */
export function cataloguePathProblem(path: string): string | undefined {
  if (path === CATALOGUE_FILE) return undefined;
  const [id = '', version = '', ...file] = path.split('/');
  if (!PACK_ID.test(id)) return 'A path under the catalogue begins with a pack’s name.';
  if (!PACK_VERSION.test(version)) {
    return 'A pack’s name in a path under the catalogue is followed by its version.';
  }
  return file.length === 0
    ? 'A path under the catalogue names a file of a pack version.'
    : packFilePathProblem(file.join('/'));
}
