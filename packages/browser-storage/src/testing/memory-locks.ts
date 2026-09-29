/**
 * A lock manager in memory, with the Web Locks behaviour the lease coordination
 * rests on, shared by the simulated windows of one test as one browser
 * profile's windows share `navigator.locks`.
 *
 * A request is granted in a later turn, and the lock is held until the promise
 * its callback returned settles, which then settles the request with it. A lock
 * is `exclusive` unless asked for `shared`: any number share it, and an
 * exclusive holder holds it alone. Requests are granted in the order made, so a
 * request waits behind an earlier one still waiting, whatever its mode.
 * `ifAvailable` calls the callback with `null` at once where the lock cannot be
 * granted then. `steal` takes the lock from every holder, whose requests reject
 * with an `AbortError` while their callbacks' promises are still pending, and
 * is granted ahead of every waiter. A waiting request whose signal aborts
 * rejects with an `AbortError`. Every call can be made to refuse, as a browser
 * that refuses the lock manager to a page does.
 */

import type { LeaseLockOptions, LeaseLocks } from '../lock-manager.js';

type Mode = 'shared' | 'exclusive';

interface Asking {
  readonly name: string;
  readonly mode: Mode;
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

  readonly #held = new Map<string, Asking[]>();
  readonly #waiting: Asking[] = [];

  request(
    name: string,
    options: LeaseLockOptions,
    callback: (lock: Lock | null) => Promise<void>,
  ): Promise<void> {
    if (this.refusal?.thrown === true) throw this.refusal.error;
    if (this.refusal !== undefined) return Promise.reject(this.refusal.error);
    return new Promise((resolve, reject) => {
      const asking: Asking = { name, mode: options.mode ?? 'exclusive', callback, resolve, reject };
      if (options.steal === true) {
        for (const holder of this.#held.get(name) ?? []) {
          holder.reject(aborted('The lock was stolen.'));
        }
        this.#held.delete(name);
        this.#grant(asking);
        return;
      }
      const queued = this.#waiting.some((other) => other.name === name);
      if (!queued && this.#grantable(asking)) {
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
    const held = [...this.#held].flatMap(([name, holders]) => holders.map(() => ({ name })));
    return Promise.resolve({ held });
  }

  /** Takes a lock from its holders for a reason other than a steal, as a browser may. */
  drop(name: string, error: DOMException): void {
    const holders = this.#held.get(name);
    if (holders === undefined) throw new Error(`Nothing holds ${name}.`);
    this.#held.delete(name);
    for (const holder of holders) holder.reject(error);
    this.#next(name);
  }

  #grantable(asking: Asking): boolean {
    const holders = this.#held.get(asking.name) ?? [];
    return (
      holders.length === 0 ||
      (asking.mode === 'shared' && holders.every((holder) => holder.mode === 'shared'))
    );
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
        this.#next(asking.name);
      },
      { once: true },
    );
  }

  #grant(asking: Asking): void {
    this.#held.set(asking.name, [...(this.#held.get(asking.name) ?? []), asking]);
    const lock: Lock = { name: asking.name, mode: asking.mode };
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
    const holders = this.#held.get(asking.name) ?? [];
    if (!holders.includes(asking)) return;
    const left = holders.filter((holder) => holder !== asking);
    if (left.length === 0) this.#held.delete(asking.name);
    else this.#held.set(asking.name, left);
    settle();
    this.#next(asking.name);
  }

  /** Grants the waiting requests of a name that can be granted, in the order made. */
  #next(name: string): void {
    for (;;) {
      const next = this.#waiting.find((other) => other.name === name);
      if (next === undefined || !this.#grantable(next)) return;
      this.#waiting.splice(this.#waiting.indexOf(next), 1);
      this.#grant(next);
    }
  }
}
