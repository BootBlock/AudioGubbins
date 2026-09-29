/**
 * Broadcast channels in memory, shared by the simulated windows of one test as
 * one browser profile's windows share `BroadcastChannel`.
 *
 * A message is copied as the browser clones it and delivered in a later turn to
 * every other open channel of its name, never to the one that posted it, and
 * not to a channel closed before it arrives. A closed channel refuses to post
 * with an `InvalidStateError`, and the bus can close every channel under the
 * page, as a browser may.
 *
 * Delivery takes a microtask, as the memory lock manager's grants and steals
 * do, so a message and a lock change reach a window in the order they were
 * made, as the browser's tasks do.
 */

import type { LeaseChannel } from '../project-channels.js';

type Listener = (event: { readonly data: unknown }) => void;

class MemoryChannel implements LeaseChannel {
  readonly name: string;
  closed = false;
  readonly #bus: MemoryBroadcast;
  readonly #listeners: Listener[] = [];

  constructor(bus: MemoryBroadcast, name: string) {
    this.#bus = bus;
    this.name = name;
  }

  postMessage(message: unknown): void {
    if (this.closed) throw new DOMException('The channel is closed.', 'InvalidStateError');
    this.#bus.deliver(this, structuredClone(message));
  }

  addEventListener(_type: 'message', listener: Listener): void {
    this.#listeners.push(listener);
  }

  close(): void {
    this.closed = true;
    this.#bus.forget(this);
  }

  receive(data: unknown): void {
    if (this.closed) return;
    for (const listener of this.#listeners) listener({ data });
  }
}

/** One profile's broadcast channels (see the module comment). */
export class MemoryBroadcast {
  readonly #open = new Set<MemoryChannel>();

  /** Every message posted, in order, for a test to read what went between the windows. */
  readonly posted: unknown[] = [];

  readonly open = (name: string): LeaseChannel => {
    const channel = new MemoryChannel(this, name);
    this.#open.add(channel);
    return channel;
  };

  /** How many channels are open, so a test can see none is left behind. */
  get openCount(): number {
    return this.#open.size;
  }

  deliver(from: MemoryChannel, data: unknown): void {
    this.posted.push(data);
    for (const channel of this.#open) {
      if (channel === from || channel.name !== from.name) continue;
      void Promise.resolve().then(() => {
        channel.receive(structuredClone(data));
      });
    }
  }

  forget(channel: MemoryChannel): void {
    this.#open.delete(channel);
  }

  /** Closes every open channel, as a browser may under a page. */
  closeAll(): void {
    for (const channel of [...this.#open]) channel.closed = true;
  }
}

/** Waits until every message posted and every lock change made so far has arrived. */
export async function settled(): Promise<void> {
  // Both fakes act in microtasks, and a timer runs only once they are done.
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
