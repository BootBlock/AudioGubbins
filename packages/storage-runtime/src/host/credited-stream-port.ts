/**
 * The storage worker's end of a channel the codec worker writes (ADR-0090,
 * ADR-0092): a decoded import's stream or an encoded export's, given the
 * storage in order, with the credit that keeps the codec worker from running
 * ahead of the writes.
 *
 * The codec worker sends nothing until it is given credit, and each message it
 * sends spends one. The first credit is one, for a decoded stream's
 * description, so a file is analysed before a block of it is decoded, and an
 * encoded stream's first bytes alike; once the first message is read, credit is
 * given back as the storage reads, keeping up to a window of messages asked for
 * and not yet read, so the two workers overlap and neither holds more than the
 * window of blocks. A message the protocol does not hold ends the stream as a
 * refusal, and once the stream has ended, refused or been closed, the port is
 * closed and anything arriving is dropped.
 */

import type { DomainFailure, DomainResult } from '@audiogubbins/domain';
import {
  readDecodedStreamMessage,
  readEncodedStreamMessage,
  type DecodedStreamMessage,
  type EncodedStreamMessage,
  type StreamReceiverMessage,
} from '@audiogubbins/import-export';

/** The messages asked for and not yet read, once the first is: a few blocks. */
const CREDIT_WINDOW = 8;

/** A port a codec worker writes a stream to, as far as the stream uses it. */
export interface StreamPort {
  postMessage(message: StreamReceiverMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  start(): void;
  close(): void;
}

/** A stream's message read from what crossed, or why it does not read. */
type Reader<TMessage> = (value: unknown) => DomainResult<TMessage>;

/** The decoded stream the codec worker writes to `port` (see the module comment). */
export function portDecodedStream(port: StreamPort): CreditedStream<DecodedStreamMessage> {
  return portStream(port, readDecodedStreamMessage);
}

/** The encoded stream the codec worker writes to `port` (see the module comment). */
export function portEncodedStream(port: StreamPort): CreditedStream<EncodedStreamMessage> {
  return portStream(port, readEncodedStreamMessage);
}

/**
 * The messages of one kind of stream the codec worker writes to `port`, with
 * credit, each read field by field; one that does not read ends the stream
 * as the failure its reading gives.
 */
function portStream<TMessage extends { readonly kind: string }>(
  port: StreamPort,
  read: Reader<TMessage>,
): CreditedStream<TMessage | { readonly kind: 'failed'; readonly failure: DomainFailure }> {
  const stream = new CreditedStream<
    TMessage | { readonly kind: 'failed'; readonly failure: DomainFailure }
  >(port);
  port.addEventListener('message', (event) => {
    const message = read(event.data);
    stream.arrived(message.ok ? message.value : { kind: 'failed', failure: message.failures[0] });
  });
  port.start();
  return stream;
}

/** A stream's messages as they arrive, read in order, with credit given as they are. */
export class CreditedStream<TMessage> {
  readonly #port: StreamPort;
  readonly #queued: TMessage[] = [];
  #waiting: ((message: TMessage | undefined) => void) | undefined;
  #open = true;
  #granted = 0;
  /** The messages handed to the storage: credit is given back as they are read, not as they arrive. */
  #read = 0;
  #begun = false;

  constructor(port: StreamPort) {
    this.#port = port;
    this.#grant(1);
  }

  /** Takes a message that arrived, to a read waiting or the queue. */
  arrived(message: TMessage): void {
    if (!this.#open) return;
    const waiting = this.#waiting;
    this.#waiting = undefined;
    if (waiting === undefined) this.#queued.push(message);
    else waiting(message);
  }

  /** Ends the stream with `message` where it is still open, as its last. */
  end(message: TMessage): void {
    this.arrived(message);
  }

  readonly next = (): Promise<TMessage | undefined> => {
    // Asked for and not yet read, whether still to come or already queued:
    // counting only those still to come would let a slow reader's queue grow
    // by a window at every read.
    const asked = this.#granted - this.#read;
    if (this.#begun && asked < CREDIT_WINDOW / 2) this.#grant(CREDIT_WINDOW - asked);
    this.#begun = true;
    const message = this.#queued.shift();
    if (message !== undefined || !this.#open) return Promise.resolve(this.#taken(message));
    return new Promise((resolve) => {
      this.#waiting = (arrived) => {
        resolve(this.#taken(arrived));
      };
    });
  };

  readonly refuse = (failure: DomainFailure): void => {
    if (this.#open) this.#port.postMessage({ kind: 'refused', failure });
    this.close();
  };

  readonly close = (): void => {
    if (!this.#open) return;
    this.#open = false;
    this.#port.close();
    this.#waiting?.(undefined);
    this.#waiting = undefined;
  };

  /** Counts a message handed to the storage as read. */
  #taken(message: TMessage | undefined): TMessage | undefined {
    if (message !== undefined) this.#read += 1;
    return message;
  }

  #grant(credit: number): void {
    this.#granted += credit;
    this.#port.postMessage({ kind: 'ready', credit });
  }
}
