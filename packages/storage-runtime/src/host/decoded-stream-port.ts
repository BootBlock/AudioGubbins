/**
 * The storage worker's end of a decoded import's channel (ADR-0090): the
 * messages the codec worker posts of one file, given the storage in order as
 * its `DecodedStream`, with the credit that keeps the codec worker from
 * running ahead of the writes.
 *
 * The codec worker sends nothing until it is given credit, and each message
 * it sends spends one. The first credit is one, for the stream's description,
 * so a file is analysed before a block of it is decoded; once the description
 * is read, credit is given back as the storage reads, keeping up to a window
 * of messages asked for and not yet read, so the two workers overlap and
 * neither holds more than the window of blocks. A message the protocol does
 * not hold ends the stream as a refusal, and once the stream has ended,
 * refused or been closed, the port is closed and anything arriving is
 * dropped.
 */

import { FailureKind, failure, type DomainFailure } from '@audiogubbins/domain';
import type { DecodedStreamMessage, StreamReceiverMessage } from '@audiogubbins/import-export';
import type { DecodedStream } from '@audiogubbins/storage';

/** The messages asked for and not yet read, once the description is: a few blocks. */
const CREDIT_WINDOW = 8;

/** A port a codec worker writes a decoded stream to, as far as the stream uses it. */
export interface StreamPort {
  postMessage(message: StreamReceiverMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  start(): void;
  close(): void;
}

/** What a message the protocol does not hold ends the stream as. */
const UNREADABLE = failure(
  'import.stream-unreadable',
  FailureKind.IntegrityViolation,
  'The codec worker sent a message a decoded stream does not hold.',
);

const KINDS: ReadonlySet<unknown> = new Set(['description', 'block', 'end', 'failed']);

/** Whether a message is one of the stream's, by its kind. */
function isStreamMessage(value: unknown): value is DecodedStreamMessage {
  return typeof value === 'object' && value !== null && KINDS.has(Reflect.get(value, 'kind'));
}

/** The decoded stream the codec worker writes to `port` (see the module comment). */
export function portDecodedStream(port: StreamPort): DecodedStream {
  const queued: DecodedStreamMessage[] = [];
  let waiting: ((message: DecodedStreamMessage | undefined) => void) | undefined;
  let open = true;
  let granted = 0;
  let received = 0;
  let described = false;

  const grant = (credit: number): void => {
    granted += credit;
    port.postMessage({ kind: 'ready', credit });
  };
  const end = (): void => {
    if (!open) return;
    open = false;
    port.close();
    waiting?.(undefined);
    waiting = undefined;
  };
  port.addEventListener('message', (event) => {
    if (!open) return;
    received += 1;
    const message: DecodedStreamMessage = isStreamMessage(event.data)
      ? event.data
      : { kind: 'failed', failure: UNREADABLE };
    if (waiting === undefined) {
      queued.push(message);
      return;
    }
    const resolve = waiting;
    waiting = undefined;
    resolve(message);
  });
  port.start();
  grant(1);

  return {
    next: () => {
      if (described && granted - received < CREDIT_WINDOW / 2) {
        grant(CREDIT_WINDOW - (granted - received));
      }
      described = true;
      const message = queued.shift();
      if (message !== undefined || !open) return Promise.resolve(message);
      return new Promise((resolve) => {
        waiting = resolve;
      });
    },
    refuse: (failure: DomainFailure) => {
      if (open) port.postMessage({ kind: 'refused', failure });
      end();
    },
    close: end,
  };
}
