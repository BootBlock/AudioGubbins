/**
 * The broadcast channels over which the windows of one browser profile talk
 * about a project's write lease: one per project, open while anything of this
 * window listens on it (REQ-STOR-098).
 *
 * A window's messages never come back to the channel that posted them, but they
 * do reach every other channel of the same name, this window's own included. So
 * everything this window posts about a project goes through the one channel it
 * listens on, where it has one, and it never hears itself.
 *
 * A channel the browser will not open, or has closed under the page, is a
 * designed outcome: the windows cannot identify one another or ask for a
 * project, and the caller hears that a message did not go, never an error.
 */

import type { Logger } from '@audiogubbins/diagnostics';

import { postedForm, readLeaseMessage, type LeaseMessage } from './lease-messages.js';

/** The members of a `BroadcastChannel` the lease coordination uses. */
export interface LeaseChannel {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
  close(): void;
}

/** Opens the channel of a name, as `StoragePlatform.openBroadcastChannel` does. */
export type OpenLeaseChannel = (name: string) => LeaseChannel;

type Listener = (message: LeaseMessage) => void;

interface Line {
  readonly channel: LeaseChannel;
  readonly listeners: Set<Listener>;
}

/** The lease channels of one window (see the module comment). */
export class ProjectChannels {
  readonly #open: OpenLeaseChannel | undefined;
  readonly #logger: Logger;
  readonly #lines = new Map<string, Line>();

  constructor(open: OpenLeaseChannel | undefined, logger: Logger) {
    this.#open = open;
    this.#logger = logger;
  }

  /** Calls `listener` with each message about the channel's project until the returned function is called. */
  listen(name: string, listener: Listener): () => void {
    const line = this.#lines.get(name) ?? this.#opened(name);
    if (line === undefined) return () => undefined;
    line.listeners.add(listener);
    return () => {
      line.listeners.delete(listener);
      if (line.listeners.size > 0) return;
      if (this.#lines.get(name) === line) this.#lines.delete(name);
      line.channel.close();
    };
  }

  /** Posts a message to the other windows, answering whether it went. */
  post(name: string, message: LeaseMessage): boolean {
    const line = this.#lines.get(name);
    // Delivery is queued as the message is posted, so a channel opened for one
    // message can be closed at once without losing it.
    const channel = line?.channel ?? this.#channel(name);
    if (channel === undefined) return false;
    try {
      channel.postMessage(postedForm(message));
      return true;
    } catch (error) {
      // A channel the browser closed under the page refuses with
      // `InvalidStateError`; it is dropped, so the next use opens another.
      if (!(error instanceof DOMException)) throw error;
      this.#logger.warning('A lease message could not be posted to the other windows.', {
        reason: error.name,
      });
      if (line !== undefined) this.#lines.delete(name);
      return false;
    } finally {
      if (line === undefined) channel.close();
    }
  }

  #opened(name: string): Line | undefined {
    const channel = this.#channel(name);
    if (channel === undefined) return undefined;
    const line: Line = { channel, listeners: new Set() };
    channel.addEventListener('message', (event) => {
      const message = readLeaseMessage(event.data);
      if (message === undefined) return;
      for (const listener of line.listeners) listener(message);
    });
    this.#lines.set(name, line);
    return line;
  }

  #channel(name: string): LeaseChannel | undefined {
    if (this.#open === undefined) return undefined;
    try {
      return this.#open(name);
    } catch (error) {
      // An opaque origin, such as a sandboxed frame, may refuse to open one.
      if (!(error instanceof DOMException)) throw error;
      this.#logger.warning('The browser refused a channel to the other windows.', {
        reason: error.name,
      });
      return undefined;
    }
  }
}
