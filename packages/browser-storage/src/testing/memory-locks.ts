/**
 * A lock manager in memory, with the Web Locks behaviour the lease coordination
 * rests on, shared by the simulated windows of one test as one browser
 * profile's windows share `navigator.locks`.
 *
 * A request is granted in a later turn, and the lock is held until the promise
 * its callback returned settles, which then settles the request with it.
 * `ifAvailable` calls the callback with `null` at once where the lock is held
 * or asked for. `steal` takes the lock from its holder, whose request rejects
 * with an `AbortError` while its callback's promise is still pending, and is
 * granted ahead of every waiter. A waiting request whose signal aborts rejects
 * with an `AbortError`. Every call can be made to refuse, as a browser that
 * refuses the lock manager to a page does.
 */

import type { LeaseLockOptions, LeaseLocks } from '../web-lock-leases.js';

interface Asking {
  readonly name: string;
  readonly callback: (lock: Lock | null) => Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

function aborted(message: string): DOMException {
  return new DOMException(message, 'AbortError');
}

/** Web Locks in memory (see the module comment). */
export class MemoryLocks implements LeaseLocks {
  /** Where set, every request and query refuses with it, as it is thrown or rejected. */
  refusal: { readonly error: DOMException; readonly thrown: boolean } | undefined;

  readonly #held = new Map<string, Asking>();
  readonly #waiting: Asking[] = [];

  request(
    name: string,
    options: LeaseLockOptions,
    callback: (lock: Lock | null) => Promise<void>,
  ): Promise<void> {
    if (this.refusal?.thrown === true) throw this.refusal.error;
    if (this.refusal !== undefined) return Promise.reject(this.refusal.error);
    return new Promise((resolve, reject) => {
      const asking: Asking = { name, callback, resolve, reject };
      const current = this.#held.get(name);
      if (options.steal === true) {
        if (current !== undefined) {
          this.#held.delete(name);
          current.reject(aborted('The lock was stolen.'));
        }
        this.#grant(asking);
        return;
      }
      const taken = current !== undefined || this.#waiting.some((other) => other.name === name);
      if (!taken) {
        this.#grant(asking);
        return;
      }
      if (options.ifAvailable === true) {
        void Promise.resolve()
          .then(() => callback(null))
          .then(resolve, reject);
        return;
      }
      this.#wait(asking, options.signal);
    });
  }

  query(): Promise<{ readonly held: readonly { readonly name: string }[] }> {
    if (this.refusal !== undefined) return Promise.reject(this.refusal.error);
    return Promise.resolve({ held: [...this.#held.keys()].map((name) => ({ name })) });
  }

  /** Takes a lock from its holder for a reason other than a steal, as a browser may. */
  drop(name: string, error: DOMException): void {
    const current = this.#held.get(name);
    if (current === undefined) throw new Error(`Nothing holds ${name}.`);
    this.#held.delete(name);
    current.reject(error);
    this.#next(name);
  }

  #wait(asking: Asking, signal: AbortSignal | undefined): void {
    if (signal?.aborted === true) {
      asking.reject(aborted('The request was called off.'));
      return;
    }
    this.#waiting.push(asking);
    signal?.addEventListener(
      'abort',
      () => {
        const index = this.#waiting.indexOf(asking);
        if (index < 0) return;
        this.#waiting.splice(index, 1);
        asking.reject(aborted('The request was called off.'));
      },
      { once: true },
    );
  }

  #grant(asking: Asking): void {
    this.#held.set(asking.name, asking);
    const lock: Lock = { name: asking.name, mode: 'exclusive' };
    void Promise.resolve()
      .then(() => asking.callback(lock))
      .then(
        () => {
          this.#settle(asking, () => {
            asking.resolve();
          });
        },
        (error: unknown) => {
          this.#settle(asking, () => {
            asking.reject(error);
          });
        },
      );
  }

  /** Releases a lock whose callback settled, where it was not taken first. */
  #settle(asking: Asking, settle: () => void): void {
    if (this.#held.get(asking.name) !== asking) return;
    this.#held.delete(asking.name);
    settle();
    this.#next(asking.name);
  }

  #next(name: string): void {
    const index = this.#waiting.findIndex((other) => other.name === name);
    const next = this.#waiting[index];
    if (next === undefined) return;
    this.#waiting.splice(index, 1);
    this.#grant(next);
  }
}
