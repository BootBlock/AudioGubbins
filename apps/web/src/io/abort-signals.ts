/**
 * The domain's cancellation as the browser's: the storage client and every
 * other browser port take an `AbortSignal`, while the packages that run in any
 * thread hand on the `CancellationSignal` they read (`@audiogubbins/domain`).
 */

import type { CancellationSignal } from '@audiogubbins/domain';

/** An `AbortSignal` that aborts as `signal` is cancelled, with its reason. */
export function abortSignalOf(signal: CancellationSignal): AbortSignal {
  const controller = new AbortController();
  if (signal.aborted) controller.abort(signal.reason);
  else {
    signal.addEventListener(
      'abort',
      () => {
        controller.abort(signal.reason);
      },
      { once: true },
    );
  }
  return controller.signal;
}
