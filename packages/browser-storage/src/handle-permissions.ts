/**
 * Whether the user lets AudioGubbins read a file it kept a handle to.
 *
 * Chromium asks again after a handle is taken back out of storage, and may be
 * asked for access only in answer to a user's gesture, so the query and the
 * request are two calls: the query can be made at any time, and the request
 * only from the control the user pressed. Neither is in the DOM type
 * definitions, so both are reached through `Reflect` and their answers are
 * checked. A browser whose handles have no permission methods grants what a
 * handle names for as long as the page holds it, so its answer is `granted`.
 */

/** Whether reading is allowed, not allowed, or has to be asked for. */
export type HandlePermission = 'granted' | 'prompt' | 'denied';

const PERMISSIONS: ReadonlySet<unknown> = new Set<HandlePermission>([
  'granted',
  'prompt',
  'denied',
]);

function isPermission(value: unknown): value is HandlePermission {
  return PERMISSIONS.has(value);
}

async function askFor(handle: FileSystemHandle, method: string): Promise<HandlePermission> {
  const ask: unknown = Reflect.get(handle, method);
  if (typeof ask !== 'function') return 'granted';
  const answer: unknown = await Reflect.apply(ask, handle, [{ mode: 'read' }]);
  if (!isPermission(answer)) {
    throw new TypeError('A handle answered its permission with something that is not one.');
  }
  return answer;
}

/** Whether the handle may be read now, without asking the user. */
export function queryReadPermission(handle: FileSystemHandle): Promise<HandlePermission> {
  return askFor(handle, 'queryPermission');
}

/** Asks the user to let the handle be read; only in answer to their gesture. */
export function requestReadPermission(handle: FileSystemHandle): Promise<HandlePermission> {
  return askFor(handle, 'requestPermission');
}
