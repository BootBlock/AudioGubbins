/**
 * Whether the user lets AudioGubbins read a file it kept a handle to, or write
 * into a folder it kept one to.
 *
 * Chromium asks again after a handle is taken back out of storage, and may be
 * asked for access only in answer to a user's gesture, so the query and the
 * request are two calls: the query can be made at any time, and the request
 * only from the control the user pressed. Neither is in the DOM type
 * definitions, so both are reached through `Reflect` and their answers are
 * checked. A browser whose handles have no permission methods grants what a
 * handle names for as long as the page holds it, so its answer is `granted`.
 */

/** Whether access is allowed, not allowed, or has to be asked for. */
export type HandlePermission = 'granted' | 'prompt' | 'denied';

/** Reading alone, or reading and writing. */
type AccessMode = 'read' | 'readwrite';

const PERMISSIONS: ReadonlySet<unknown> = new Set<HandlePermission>([
  'granted',
  'prompt',
  'denied',
]);

function isPermission(value: unknown): value is HandlePermission {
  return PERMISSIONS.has(value);
}

async function askFor(
  handle: FileSystemHandle,
  method: string,
  mode: AccessMode,
): Promise<HandlePermission> {
  const ask: unknown = Reflect.get(handle, method);
  if (typeof ask !== 'function') return 'granted';
  const answer: unknown = await Reflect.apply(ask, handle, [{ mode }]);
  if (!isPermission(answer)) {
    throw new TypeError('A handle answered its permission with something that is not one.');
  }
  return answer;
}

/** Whether the handle may be read now, without asking the user. */
export function queryReadPermission(handle: FileSystemHandle): Promise<HandlePermission> {
  return askFor(handle, 'queryPermission', 'read');
}

/**
 * Asks the user through `request` for leave that is needed, answering that it
 * is still needed where the browser will not ask now: it refuses with a
 * `SecurityError` a request made once the gesture it answers has lapsed, which
 * a request after a long wait or another prompt is.
 */
async function requested(request: () => Promise<HandlePermission>): Promise<HandlePermission> {
  try {
    return await request();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'SecurityError') return 'prompt';
    throw error;
  }
}

/** Asks the user to let the handle be read; only in answer to their gesture. */
export function requestReadPermission(handle: FileSystemHandle): Promise<HandlePermission> {
  return requested(() => askFor(handle, 'requestPermission', 'read'));
}

/** Whether the handle may be written now, without asking the user. */
export function queryWritePermission(handle: FileSystemHandle): Promise<HandlePermission> {
  return askFor(handle, 'queryPermission', 'readwrite');
}

/** Asks the user to let the handle be written; only in answer to their gesture. */
export function requestWritePermission(handle: FileSystemHandle): Promise<HandlePermission> {
  return requested(() => askFor(handle, 'requestPermission', 'readwrite'));
}
