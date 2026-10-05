/**
 * Giving up storage work the page no longer needs.
 *
 * Every long operation the page starts in the storage worker is given a signal,
 * which the worker hears mid-path (ADR-0022), so work nothing waits for any
 * more stops rather than holding the worker and the storage: a request of one
 * kind replaced by a newer one, the work done for a project once it is let go,
 * and everything the project system started once the page takes it down. An
 * operation given up rejects with its signal's reason, an `AbortError`, which
 * is no failure: nothing waits for its outcome, so nothing says it or logs it.
 * One the worker had carried out before it heard answers as it would have,
 * since what it changed must be known, so an answer only worth having for the
 * request that asked it is dropped once that request was given up.
 */

/**
 * Whether `error` ends work the page gave up, rather than reporting a fault.
 * Told by its name rather than by `instanceof`, which answers for one realm's
 * `DOMException` alone, and a signal's own reason may be another's.
 */
export function isAbandoned(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  );
}

/** The reason work is given up for `why`, as every abandoned call rejects with it. */
export function abandonment(why: string): DOMException {
  return new DOMException(why, 'AbortError');
}

/** The reason `signal` aborted with, as the error a call given up with it rejects with. */
export function reasonOf(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason : abandonment('The work was given up.');
}

/**
 * Aborts `controller` with the reason `scope` aborts with, from when it does,
 * and answers what stops following it.
 */
export function within(controller: AbortController, scope: AbortSignal): () => void {
  if (scope.aborted) {
    controller.abort(scope.reason);
    return () => undefined;
  }
  const abort = (): void => {
    controller.abort(scope.reason);
  };
  scope.addEventListener('abort', abort, { once: true });
  return () => {
    scope.removeEventListener('abort', abort);
  };
}

/**
 * Requests of one kind, each replacing the one before it: a request's signal
 * aborts once a newer one is made, and once the scope it was made in ends.
 */
export class Requests {
  readonly #scope: () => AbortSignal;
  #current: { readonly controller: AbortController; readonly unfollow: () => void } | undefined;

  /** Requests made within the scope `scope` answers as each is made. */
  constructor(scope: () => AbortSignal) {
    this.#scope = scope;
  }

  /** The signal of a new request, which gives up the one before it. */
  next(): AbortSignal {
    if (this.#current !== undefined) {
      this.#current.unfollow();
      this.#current.controller.abort(abandonment('A newer request replaced this one.'));
    }
    const controller = new AbortController();
    this.#current = { controller, unfollow: within(controller, this.#scope()) };
    return controller.signal;
  }
}
