/**
 * Where this repository is, for a test that reads a file in it.
 *
 * One declaration of the root. A test that walked up from `import.meta.dirname`
 * itself would take the number of steps from where its file happens to sit, so
 * each such file would carry a root of its own, and a test moved between
 * `tests/` and `tests/architecture/` would read the wrong one and find nothing.
 * The glob is held in one place for the same reason, in
 * `architecture/source-reading.ts`, which reads its root from here.
 */

import { join } from 'node:path';

/** The repository's root. */
export const REPOSITORY_ROOT = join(import.meta.dirname, '..');

/** A path inside the repository, from its parts. */
export function inRepository(...parts: readonly string[]): string {
  return join(REPOSITORY_ROOT, ...parts);
}

/**
 * A path written with forward slashes.
 *
 * What a comparison against a repository-relative path needs: `join` gives
 * backslashes on Windows, and every path a rule compares against is written
 * with forward slashes. Written out at each call site, the rewrite would drift
 * from one call site to the next, as would the reading of the root beside it,
 * so a rule in `dependency-rules.test.ts` holds this module the only one under
 * `tests/` that rewrites a path's backslashes, in whichever shape the rewrite
 * is written.
 */
export function forwardSlashes(path: string): string {
  return path.replaceAll('\\', '/');
}
