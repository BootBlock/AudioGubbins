import { describe, expect, it } from 'vitest';

import type { EncodedStreamMessage, StreamReceiverMessage } from '@audiogubbins/import-export';

import { portEncodedStream } from './credited-stream-port.js';

/**
 * The storage worker's end of a long stream the codec worker writes
 * (ADR-0090, ADR-0092): however far the codec worker could run ahead, the
 * credit the storage gives as it reads holds what has crossed and is not yet
 * read to the window, so a long file is never held in the storage worker
 * whole. A codec worker sends a body of 1 MiB, the most a block holds, for
 * each credit; the storage reads slower than it could send.
 */

/** The most messages asked for and not yet read, as the port keeps to. */
const CREDIT_WINDOW = 8;

/** The bytes of each body, the most a block holds. */
const BODY_BYTES = 1_048_576;

/** A codec worker writing `bodies` bodies and the end, a message for each credit, never more. */
class CreditedProducer {
  sent = 0;
  readonly #port: MessagePort;
  readonly #bodies: number;
  #credit = 0;

  constructor(port: MessagePort, bodies: number) {
    this.#port = port;
    this.#bodies = bodies;
    port.addEventListener('message', (event: MessageEvent<StreamReceiverMessage>) => {
      if (event.data.kind !== 'ready') return;
      this.#credit += event.data.credit;
      this.#send();
    });
    port.start();
  }

  #send(): void {
    while (this.#credit > 0 && this.sent <= this.#bodies) {
      this.#credit -= 1;
      const message: EncodedStreamMessage =
        this.sent === this.#bodies
          ? {
              kind: 'finished',
              file: { head: new Uint8Array(8), tail: new Uint8Array(0), dropped: [] },
            }
          : { kind: 'body', bytes: new Uint8Array(BODY_BYTES) };
      this.#port.postMessage(message, message.kind === 'body' ? [message.bytes.buffer] : []);
      this.sent += 1;
    }
  }
}

describe('the storage worker reading a long stream', () => {
  it('holds what has crossed and is not yet read to its window of credit, however slowly it reads', async () => {
    const bodies = 96;
    const channel = new MessageChannel();
    const producer = new CreditedProducer(channel.port2, bodies);
    const stream = portEncodedStream(channel.port1);

    let read = 0;
    let mostAhead = 0;
    let bytes = 0;
    for (;;) {
      const message = await stream.next();
      if (message === undefined) throw new Error('The stream stopped before it finished.');
      read += 1;
      mostAhead = Math.max(mostAhead, producer.sent - read);
      if (message.kind === 'finished') break;
      if (message.kind !== 'body') throw new Error(`The stream sent ${message.kind}.`);
      bytes += message.bytes.length;
      // A write that takes its time, as the storage's does.
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    stream.close();
    channel.port2.close();

    expect(bytes).toBe(bodies * BODY_BYTES);
    expect(mostAhead).toBeGreaterThan(0);
    expect(mostAhead).toBeLessThanOrEqual(CREDIT_WINDOW);
  });
});
