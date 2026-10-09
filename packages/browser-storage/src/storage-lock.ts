/**
 * The locks that span the whole storage rather than one project, over Web
 * Locks (REQ-STOR-102, REQ-AUDIO-017, ADR-0020):
 *
 * - `audiogubbins.storage`, shared by each window while it writes what is not
 *   whole until it finishes, and held alone by whatever removes what a crash
 *   left, so a purge or a cleanup in one window never removes what another is
 *   writing;
 * - `audiogubbins.library`, held alone by the window changing the person's
 *   library of saved chains and presets, so two windows never both find a
 *   name free and both take it.
 *
 * A lock is asked for in the mode given; without waiting it is asked for only
 * if available, and with waiting until it is granted or the caller's signal
 * aborts, which rejects with the signal's reason. It is held for as long as
 * the promise its callback returns is pending, so releasing settles that
 * promise and then waits for the browser to let the lock go. A lock the
 * browser refuses is `unavailable`, logged, and never taken to be held.
 */

import type { Logger } from '@audiogubbins/diagnostics';
import type { StorageLockMode, StorageLocking } from '@audiogubbins/storage';

import type { LeaseLockOptions, LeaseLocks } from './lock-manager.js';

/** A lock of the storage: its name, and what the log calls it. */
export interface StorageWideLock {
  readonly name: string;
  readonly called: string;
}

/** The lock that spans the whole storage. */
export const STORAGE_LOCK: StorageWideLock = {
  name: 'audiogubbins.storage',
  called: 'the storage-wide lock',
};

/** The lock on the person's library of saved chains and presets. */
export const LIBRARY_LOCK: StorageWideLock = {
  name: 'audiogubbins.library',
  called: 'the library’s lock',
};

/** How one request for the lock is answered, once. */
interface Answer {
  readonly resolve: (locking: StorageLocking) => void;
  readonly reject: (error: Error) => void;
}

/** Takes `lock` in `mode` (see the module comment). */
export function takeLock(
  locks: LeaseLocks,
  lock: StorageWideLock,
  mode: StorageLockMode,
  options: { readonly wait: boolean; readonly signal?: AbortSignal },
  logger: Logger,
): Promise<StorageLocking> {
  const { signal } = options;
  const asked: LeaseLockOptions = options.wait
    ? { mode, ...(signal === undefined ? {} : { signal }) }
    : { mode, ifAvailable: true };
  let letGo: () => void = () => undefined;
  const kept = new Promise<void>((resolve) => {
    letGo = resolve;
  });
  // Settles once the browser no longer holds the lock for this window.
  let ended: Promise<void> = Promise.resolve();

  return new Promise<StorageLocking>((resolve, reject) => {
    const answer: Answer = { resolve, reject };
    let granted = false;
    let request: Promise<void>;
    try {
      request = locks.request(lock.name, asked, async (granting) => {
        if (granting === null) {
          resolve({ kind: 'busy' });
          return;
        }
        granted = true;
        const release = async (): Promise<void> => {
          letGo();
          await ended;
        };
        resolve({ kind: 'held', release });
        await kept;
      });
    } catch (error) {
      // The browser refuses with a `DOMException`, such as a `SecurityError` in
      // a sandboxed frame; anything else is a fault, not a refusal.
      if (!(error instanceof DOMException)) throw error;
      resolve(refused(lock, error, logger));
      return;
    }
    ended = request.then(
      () => undefined,
      (error: unknown) => {
        if (granted) droppedByBrowser(lock, error, logger);
        else answerRejection(lock, error, signal, answer, logger);
      },
    );
  });
}

/** Answers a request the browser rejected before granting the lock. */
function answerRejection(
  lock: StorageWideLock,
  error: unknown,
  signal: AbortSignal | undefined,
  answer: Answer,
  logger: Logger,
): void {
  if (signal?.aborted === true) answer.reject(reasonOf(signal));
  else if (error instanceof DOMException) answer.resolve(refused(lock, error, logger));
  else answer.reject(error instanceof Error ? error : new Error('The lock request failed.'));
}

/** Logs a held lock the browser let go: nothing steals this one, so only it can. */
function droppedByBrowser(lock: StorageWideLock, error: unknown, logger: Logger): void {
  logger.warning(`The browser let ${lock.called} go.`, {
    reason: error instanceof DOMException ? error.name : 'unknown',
  });
}

/** Logs a lock the browser refused, which is then unavailable. */
function refused(lock: StorageWideLock, error: DOMException, logger: Logger): StorageLocking {
  logger.warning(`The browser refused ${lock.called}.`, { reason: error.name });
  return { kind: 'unavailable' };
}

/** The reason a wait was called off: the signal's own, where it is an error. */
function reasonOf(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error
    ? reason
    : new DOMException('The wait was called off.', 'AbortError');
}
