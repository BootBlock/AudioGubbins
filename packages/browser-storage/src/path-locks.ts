/**
 * The order in which the storage worker changes the tree.
 *
 * A synchronous access handle is exclusive, so two changes to one file at once
 * would have the second refused by the browser, and removing a directory while
 * a file in it is open is refused too. A change therefore waits for every
 * earlier change to the same path, to a path inside it and to a directory it
 * lies in, and runs at once beside any other. Waiters are served in the order
 * they asked, so two writes of one file land in the order they were sent. Reads
 * take no lock: they read a snapshot, which no writer blocks.
 */

/** Whether one path is the other, or lies inside it. */
function overlaps(one: string, other: string): boolean {
  return (
    one === other ||
    one === '' ||
    other === '' ||
    other.startsWith(`${one}/`) ||
    one.startsWith(`${other}/`)
  );
}

interface Waiter {
  readonly path: string;
  readonly grant: (release: () => void) => void;
}

/** Locks on the paths of a tree (see the module comment). */
export class PathLocks {
  readonly #held = new Set<{ readonly path: string }>();
  readonly #waiting: Waiter[] = [];

  /**
   * Waits for the path to be free of every earlier change that overlaps it, and
   * answers the function that frees it again. Rejects with the signal's reason
   * where it aborts first.
   */
  async acquire(path: string, signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted();
    const release = await new Promise<(() => void) | undefined>((resolve) => {
      const onAbort = (): void => {
        const index = this.#waiting.indexOf(waiter);
        if (index < 0) return;
        this.#waiting.splice(index, 1);
        resolve(undefined);
        // A waiter that leaves may have been all that held a later one back.
        this.#grant();
      };
      const waiter: Waiter = {
        path,
        grant: (release) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(release);
        },
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.#waiting.push(waiter);
      this.#grant();
    });
    if (release !== undefined) return release;
    // Only an abort leaves a waiter ungranted, so this throws the signal's reason.
    signal?.throwIfAborted();
    throw new Error('A wait was abandoned without its signal aborting.');
  }

  /** Grants, in order, every waiter overlapping nothing held and no earlier waiter. */
  #grant(): void {
    const passed: string[] = [];
    for (const waiter of [...this.#waiting]) {
      const blocked =
        [...this.#held].some((lock) => overlaps(lock.path, waiter.path)) ||
        passed.some((path) => overlaps(path, waiter.path));
      if (blocked) {
        passed.push(waiter.path);
        continue;
      }
      this.#waiting.splice(this.#waiting.indexOf(waiter), 1);
      const lock = { path: waiter.path };
      this.#held.add(lock);
      let released = false;
      waiter.grant(() => {
        if (released) return;
        released = true;
        this.#held.delete(lock);
        this.#grant();
      });
    }
  }
}
