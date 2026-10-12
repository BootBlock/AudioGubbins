/**
 * The domain's cancellation as the browser's: the storage client and every
 * other browser port take an `AbortSignal`, while the packages that run in any
 * thread hand on the `CancellationSignal` they read (`@audiogubbins/domain`).
 */

import type { CancellationSignal } from '@audiogubbins/domain';

/**
 * Runs `work` with an `AbortSignal` that aborts as `signal` is cancelled, with
 * its reason, and stops listening to `signal` once the work settles: a signal
 * that is never cancelled, as a view's or a thread's often is not, would
 * otherwise hold a listener for every piece of work it was ever given.
 */
export async function withAbortSignal<T>(
  signal: CancellationSignal,
  work: (abort: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const cancelled = (): void => {
    controller.abort(signal.reason);
  };
  if (signal.aborted) cancelled();
  else signal.addEventListener('abort', cancelled, { once: true });
  try {
    return await work(controller.signal);
  } finally {
    signal.removeEventListener('abort', cancelled);
  }
}
