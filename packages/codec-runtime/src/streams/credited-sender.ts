/**
 * The sending end of a stream's channel, which sends no message past the
 * credit its receiver granted (ADR-0090, ADR-0092): each `ready` adds its
 * credit, each message sent spends one, and a message with none left waits
 * for more. A receiver's refusal, or a message from it that does not read,
 * ends the stream, and every send after it answers that failure.
 */

import {
  FailureKind,
  failure,
  fail,
  succeed,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';
import { readStreamReceiverMessage } from '@audiogubbins/import-export';

import { listen, type MessagePortLike } from './stream-port.js';

/** The failure of a receiver whose message could not be deserialised. */
const UNREADABLE: DomainFailure = failure(
  'codec-runtime.stream-unreadable',
  FailureKind.Unrecoverable,
  "A message from the stream's receiver could not be read.",
);

/** A stream's sending end over `port`. */
export class CreditedSender<TMessage> {
  readonly #port: MessagePortLike;
  #credit = 0;
  #refusal: DomainFailure | undefined;
  #waiting: (() => void) | undefined;

  constructor(port: MessagePortLike) {
    this.#port = port;
    listen(
      port,
      (data) => {
        const read = readStreamReceiverMessage(data);
        if (!read.ok) this.#end(read.failures[0]);
        else if (read.value.kind === 'refused') this.#end(read.value.failure);
        else this.#grant(read.value.credit);
      },
      () => {
        this.#end(UNREADABLE);
      },
    );
  }

  /** Why the receiver ended the stream, if it has. */
  get refusal(): DomainFailure | undefined {
    return this.#refusal;
  }

  #grant(credit: number): void {
    this.#credit += credit;
    this.#wake();
  }

  #end(refusal: DomainFailure): void {
    this.#refusal ??= refusal;
    this.#wake();
  }

  #wake(): void {
    const waiting = this.#waiting;
    this.#waiting = undefined;
    waiting?.();
  }

  /**
   * Sends `message` once the receiver has credit for it, moving `transfer`,
   * or answers why the receiver ended the stream.
   */
  async send(message: TMessage, transfer: ArrayBuffer[]): Promise<DomainResult<undefined>> {
    while (this.#credit === 0 && this.#refusal === undefined) {
      await new Promise<void>((resolve) => {
        this.#waiting = resolve;
      });
    }
    if (this.#refusal !== undefined) return fail(this.#refusal);
    this.#credit -= 1;
    this.#port.postMessage(message, transfer);
    return succeed(undefined);
  }

  /** Closes the channel: the stream has ended. */
  close(): void {
    this.#port.close();
  }
}
