/**
 * What the architecture rules take for code no user receives, and for files
 * that are no source at all.
 *
 * In one place, because the rules that leave them out have to agree on them: a
 * definition of test code kept by one rule, or a build-output filter written in
 * two files, would let one rule read as production code what another leaves
 * out.
 */

/** A test or a benchmark. */
const TEST_FILE = /\.(test|spec|bench)\.tsx?$/;

/** Whether a path, written with forward slashes, is a test, a benchmark or test support under `testing/`. */
export function isTestCode(path: string): boolean {
  return TEST_FILE.test(path) || path.includes('/testing/');
}

/**
 * The directories a build writes into, under a package, an application, a tool
 * directory or `tests/`.
 *
 * The cruiser excludes the same names from its graph, and a rule in
 * `dependency-rules.test.ts` reads them out of `.dependency-cruiser.cjs` and
 * holds the two lists equal, so no directory, such as the bundled application's
 * declaration output in `apps/web/build/`, is source to one and output to the
 * other. `dev-dist/` is the service worker the development server builds, and
 * belongs here, in `.gitignore`, and in what ESLint and Prettier leave unread:
 * without it, running the development server would leave three files the cruise
 * reads as orphan modules and the lint gate reads as errors, and each gate
 * would fail on work nobody has done. Rules in the same test file hold
 * `.gitignore`, ESLint's configuration and `.prettierignore` to these lists
 * too.
 */
export const BUILD_OUTPUT_DIRECTORIES: readonly string[] = [
  'dist',
  'dist-pages',
  'dev-dist',
  'build',
  'coverage',
];

/**
 * What the cruise excludes at the repository root besides a build's output.
 *
 * A tool's own output rather than a build's: the Rust target directory and the
 * two directories Playwright writes. None is source and none is read by any
 * rule, so they are excluded from the cruise and are not build output. Named
 * here so that the rule holding the cruiser's exclusion to the rules' own
 * definition reads both of its groups, and an edit confined to this half fails
 * it.
 */
export const EXCLUDED_AT_THE_ROOT: readonly string[] = [
  'target',
  'playwright-report',
  'test-results',
];

/** {@link BUILD_OUTPUT_DIRECTORIES}, as a path segment. */
const BUILD_OUTPUT = new RegExp(`/(?:${BUILD_OUTPUT_DIRECTORIES.join('|')})/`);

/**
 * Whether a path, written with forward slashes, is a build's own output: what
 * a compiler or a bundler wrote from the source, which every rule reads in its
 * source form.
 */
export function isBuildOutput(path: string): boolean {
  return BUILD_OUTPUT.test(path);
}

/**
 * Whether only a test runs this code: a test, test support, or the fixtures
 * package.
 *
 * The fixtures package is source a developer maintains, so the size and
 * cohesion rules measure it with the rest of the production code. No user
 * receives anything it exports, so the export rule reads it as test code: read
 * as an importer, it would hide domain exports nothing else uses. Both answers
 * are deliberate, and written here rather than in each rule.
 */
export function onlyForTests(path: string): boolean {
  return isTestCode(path) || path.startsWith('packages/test-fixtures/');
}
