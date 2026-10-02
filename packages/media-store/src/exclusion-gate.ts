/**
 * The order the media store's own operations keep with one another
 * (REQ-STOR-099, REQ-EXEC-136.15).
 *
 * Receiving and storing an object may overlap with any other of the kind, but
 * recovery removes what is being received and collection removes objects, so
 * either would harm a store in progress: they run alone. Two stores of the same
 * content settle one after the other, so neither rewrites an object the other
 * has sealed. The order holds within one store instance; the storage layer
 * keeps one writer of the media tree at a time across tabs.
 */

/** A waiter for the gate, admitted in arrival order. */
interface Waiter {
  readonly exclusive: boolean;
  readonly admit: () => void;
}

/**
 * Admits any number of shared holders, or one exclusive holder, in arrival
 * order: a waiting exclusive holder is admitted before any shared one that
 * arrived after it, so a stream of stores cannot keep recovery out forever.
 */
export class ExclusionGate {
  private sharedHolders = 0;
  private exclusiveHeld = false;
  private readonly waiting: Waiter[] = [];

  async shared<TResult>(work: () => Promise<TResult>): Promise<TResult> {
    return await this.holding(false, work);
  }

  async exclusive<TResult>(work: () => Promise<TResult>): Promise<TResult> {
    return await this.holding(true, work);
  }

  private async holding<TResult>(
    exclusive: boolean,
    work: () => Promise<TResult>,
  ): Promise<TResult> {
    await this.enter(exclusive);
    try {
      return await work();
    } finally {
      if (exclusive) this.exclusiveHeld = false;
      else this.sharedHolders -= 1;
      this.admitWaiting();
    }
  }

  private async enter(exclusive: boolean): Promise<void> {
    if (this.waiting.length === 0 && this.admits(exclusive)) {
      this.take(exclusive);
      return;
    }
    await new Promise<void>((admit) => {
      this.waiting.push({ exclusive, admit });
    });
  }

  private admitWaiting(): void {
    for (let next = this.waiting[0]; next !== undefined; next = this.waiting[0]) {
      if (!this.admits(next.exclusive)) return;
      this.waiting.shift();
      this.take(next.exclusive);
      next.admit();
    }
  }

  private admits(exclusive: boolean): boolean {
    return exclusive ? !this.exclusiveHeld && this.sharedHolders === 0 : !this.exclusiveHeld;
  }

  private take(exclusive: boolean): void {
    if (exclusive) this.exclusiveHeld = true;
    else this.sharedHolders += 1;
  }
}

/** Runs work keyed alike one after another, and work keyed apart at once. */
export class KeyedQueue<TKey> {
  private readonly tails = new Map<TKey, Promise<unknown>>();

  async run<TResult>(key: TKey, work: () => Promise<TResult>): Promise<TResult> {
    const before = this.tails.get(key);
    const running = (async () => {
      // Whether the work before failed is its caller's to hear; this work
      // waits only for it to be over.
      if (before !== undefined) await Promise.allSettled([before]);
      return await work();
    })();
    this.tails.set(key, running);
    try {
      return await running;
    } finally {
      if (this.tails.get(key) === running) this.tails.delete(key);
    }
  }
}
