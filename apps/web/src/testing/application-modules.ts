/**
 * Loads the application's modules, once, before the tests of a file that mounts
 * it.
 *
 * The first import of `app.tsx` pays the transform of the whole application,
 * which can take longer than the five seconds a test is given. Paid inside a
 * test, it would put that test past them, though nothing the test asserts is
 * slow. A later import transforms nothing: it answers the modules already
 * evaluated, or, after `vi.resetModules()`, evaluates them again, so each test
 * is left what it asserts.
 */
export async function loadTheApplication(): Promise<void> {
  await import('../app.js');
}

/**
 * How long the one load may take: the transform of the whole application, on a
 * machine as busy as a full run of every suite makes it.
 */
export const LOADING_TIME = 60_000;
