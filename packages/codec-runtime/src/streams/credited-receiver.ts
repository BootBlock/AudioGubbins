/**
 * The receiving end of a stream's channel, which grants its sender credit a
 * message at a time (ADR-0090, ADR-0092): a window of credit when it opens,
 * and one more for each message taken, so at most the window waits unread
 * and the receiver always has credit outstanding while it awaits the stream.
 * Each message is read on arrival by the stream's reader; one that does not
 * read, or cannot be deserialised, ends the stream.
 */

import {
  FailureKind,
  failure,
  fail,
  throwIfCancelled,
  type CancellationSignal,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';
import type { StreamReceiverMessage } from '@audiogubbins/import-export';

import { listen, type MessagePortLike } from './stream-port.js';

const UNREADABLE: DomainFailure = failure(
  'codec-runtime.stream-unreadable',
  FailureKind.Unrecoverable,
  "A message from the stream's sender could not be read.",
);

/** Ends a stream before or as it is received, telling its sender why, and closes its channel. */
export function refuseStream(port: MessagePortLike, reason: DomainFailure): void {
  const refusal: StreamReceiverMessage = { kind: 'refused', failure: reason };
  port.postMessage(refusal, []);
  port.close();
}

/** A stream's receiving end over `port`. */
export class CreditedReceiver<TMessage> {
  readonly #port: MessagePortLike;
  readonly #arrived: DomainResult<TMessage>[] = [];
  #waiting: (() => void) | undefined;

  constructor(
    port: MessagePortLike,
    read: (value: unknown) => DomainResult<TMessage>,
    window: number,
  ) {
    this.#port = port;
    listen(
      port,
      (data) => {
        this.#arrive(read(data));
      },
      () => {
        this.#arrive(fail(UNREADABLE));
      },
    );
    this.#tell({ kind: 'ready', credit: window });
  }

  #arrive(message: DomainResult<TMessage>): void {
    this.#arrived.push(message);
    const waiting = this.#waiting;
    this.#waiting = undefined;
    waiting?.();
  }

  #tell(message: StreamReceiverMessage): void {
    this.#port.postMessage(message, []);
  }

  /**
   * The next message, waiting for it, or why it did not read; each one read
   * grants the sender one more. Cancelled, the wait rejects with the
   * signal's reason.
   */
  async next(signal: CancellationSignal): Promise<DomainResult<TMessage>> {
    for (;;) {
      throwIfCancelled(signal);
      const message = this.#arrived.shift();
      if (message !== undefined) {
        if (message.ok) this.#tell({ kind: 'ready', credit: 1 });
        return message;
      }
      await new Promise<void>((resolve) => {
        const wake = (): void => {
          signal.removeEventListener('abort', wake);
          resolve();
        };
        this.#waiting = wake;
        signal.addEventListener('abort', wake);
      });
    }
  }

  /** Ends the stream with `reason`, telling the sender, and closes the channel. */
  refuse(reason: DomainFailure): void {
    refuseStream(this.#port, reason);
  }

  /** Closes the channel: the stream has ended. */
  close(): void {
    this.#port.close();
  }
}
