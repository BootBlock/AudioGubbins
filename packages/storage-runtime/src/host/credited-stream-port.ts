/**
 * The storage worker's end of a channel the codec worker writes (ADR-0090,
 * ADR-0092): a decoded import's stream or an encoded export's, given the
 * storage in order, with the credit that keeps the codec worker from running
 * ahead of the writes.
 *
 * The codec worker sends nothing until it is given credit, and each message
 * it sends spends one. The first credit is one, for a decoded stream's
 * description, so a file is analysed before a block of it is decoded, and an
 * encoded stream's first bytes alike; once the first message is read, credit
 * is given back as the storage reads, keeping up to a window of messages
 * asked for and not yet read, so the two workers overlap and neither holds
 * more than the window of blocks. A message the protocol does
 * not hold ends the stream as a refusal, and once the stream has ended,
 * refused or been closed, the port is closed and anything arriving is
 * dropped.
 */

import { FailureKind, failure, type DomainFailure } from '@audiogubbins/domain';
import type {
  DecodedStreamMessage,
  EncodedStreamMessage,
  StreamReceiverMessage,
} from '@audiogubbins/import-export';
import type { DecodedStream, EncodedStream } from '@audiogubbins/storage';

/** The messages asked for and not yet read, once the first is: a few blocks. */
const CREDIT_WINDOW = 8;

/** A port a codec worker writes a stream to, as far as the stream uses it. */
export interface StreamPort {
  postMessage(message: StreamReceiverMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  start(): void;
  close(): void;
}

/** A message of a stream, which ends it as a failure where it is not one of the stream's. */
interface StreamKind<TMessage> {
  readonly kinds: ReadonlySet<unknown>;
  readonly unreadable: TMessage;
}

/** The kind of message of each stream, by its own kinds. */
function isMessage<TMessage>(value: unknown, kind: StreamKind<TMessage>): value is TMessage {
  return typeof value === 'object' && value !== null && kind.kinds.has(Reflect.get(value, 'kind'));
}

const DECODED: StreamKind<DecodedStreamMessage> = {
  kinds: new Set(['description', 'block', 'end', 'failed']),
  unreadable: {
    kind: 'failed',
    failure: failure(
      'import.stream-unreadable',
      FailureKind.IntegrityViolation,
      'The codec worker sent a message a decoded stream does not hold.',
    ),
  },
};

const ENCODED: StreamKind<EncodedStreamMessage> = {
  kinds: new Set(['body', 'finished', 'failed']),
  unreadable: {
    kind: 'failed',
    failure: failure(
      'export.stream-unreadable',
      FailureKind.IntegrityViolation,
      'The codec worker sent a message an encoded stream does not hold.',
    ),
  },
};

/** The decoded stream the codec worker writes to `port` (see the module comment). */
export function portDecodedStream(port: StreamPort): DecodedStream {
  return portStream(port, DECODED);
}

/** The encoded stream the codec worker writes to `port` (see the module comment). */
export function portEncodedStream(port: StreamPort): EncodedStream {
  return portStream(port, ENCODED);
}

/** The messages of one kind of stream the codec worker writes to `port`, with credit. */
function portStream<TMessage>(
  port: StreamPort,
  kind: StreamKind<TMessage>,
): CreditedStream<TMessage> {
  const stream = new CreditedStream<TMessage>(port);
  port.addEventListener('message', (event) => {
    stream.arrived(isMessage(event.data, kind) ? event.data : kind.unreadable);
  });
  port.start();
  return stream;
}

/** A stream's messages as they arrive, read in order, with credit given as they are. */
class CreditedStream<TMessage> {
  readonly #port: StreamPort;
  readonly #queued: TMessage[] = [];
  #waiting: ((message: TMessage | undefined) => void) | undefined;
  #open = true;
  #granted = 0;
  #received = 0;
  #begun = false;

  constructor(port: StreamPort) {
    this.#port = port;
    this.#grant(1);
  }

  /** Takes a message that arrived, to a read waiting or the queue. */
  arrived(message: TMessage): void {
    if (!this.#open) return;
    this.#received += 1;
    const waiting = this.#waiting;
    this.#waiting = undefined;
    if (waiting === undefined) this.#queued.push(message);
    else waiting(message);
  }

  readonly next = (): Promise<TMessage | undefined> => {
    const asked = this.#granted - this.#received;
    if (this.#begun && asked < CREDIT_WINDOW / 2) this.#grant(CREDIT_WINDOW - asked);
    this.#begun = true;
    const message = this.#queued.shift();
    if (message !== undefined || !this.#open) return Promise.resolve(message);
    return new Promise((resolve) => {
      this.#waiting = resolve;
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

  #grant(credit: number): void {
    this.#granted += credit;
    this.#port.postMessage({ kind: 'ready', credit });
  }
}
