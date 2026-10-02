/**
 * The lock that spans the whole storage, over Web Locks: shared by each window
 * while it writes what is not whole until it finishes, and held alone by
 * whatever removes what a crash left, so a purge or a cleanup in one window
 * never removes what another is writing (REQ-STOR-102, ADR-0020).
 *
 * The lock named `audiogubbins.storage` is asked for in the mode given; without
 * waiting it is asked for only if available, and with waiting until it is
 * granted or the caller's signal aborts, which rejects with the signal's
 * reason. It is held for as long as the promise its callback returns is
 * pending, so releasing settles that promise and then waits for the browser to
 * let the lock go. A lock the browser refuses is `unavailable`, logged, and
 * never taken to be held.
 */

import type { Logger } from '@audiogubbins/diagnostics';
import type { StorageLockMode, StorageLocking } from '@audiogubbins/storage';

import type { LeaseLockOptions, LeaseLocks } from './lock-manager.js';

/** The name of the lock that spans the whole storage. */
const STORAGE_LOCK = 'audiogubbins.storage';

/** How one request for the lock is answered, once. */
interface Answer {
  readonly resolve: (locking: StorageLocking) => void;
  readonly reject: (error: Error) => void;
}

/** Takes the storage-wide lock (see the module comment). */
export function lockStorage(
  locks: LeaseLocks,
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
      request = locks.request(STORAGE_LOCK, asked, async (lock) => {
        if (lock === null) {
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
      resolve(refused(error, logger));
      return;
    }
    ended = request.then(
      () => undefined,
      (error: unknown) => {
        if (granted) droppedByBrowser(error, logger);
        else answerRejection(error, signal, answer, logger);
      },
    );
  });
}

/** Answers a request the browser rejected before granting the lock. */
function answerRejection(
  error: unknown,
  signal: AbortSignal | undefined,
  answer: Answer,
  logger: Logger,
): void {
  if (signal?.aborted === true) answer.reject(reasonOf(signal));
  else if (error instanceof DOMException) answer.resolve(refused(error, logger));
  else answer.reject(error instanceof Error ? error : new Error('The lock request failed.'));
}

/** Logs a held lock the browser let go: nothing steals this one, so only it can. */
function droppedByBrowser(error: unknown, logger: Logger): void {
  logger.warning('The browser let the storage-wide lock go.', {
    reason: error instanceof DOMException ? error.name : 'unknown',
  });
}

/** Logs a lock the browser refused, which is then unavailable. */
function refused(error: DOMException, logger: Logger): StorageLocking {
  logger.warning('The browser refused the storage-wide lock.', { reason: error.name });
  return { kind: 'unavailable' };
}

/** The reason a wait was called off: the signal's own, where it is an error. */
function reasonOf(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error
    ? reason
    : new DOMException('The wait was called off.', 'AbortError');
}
