/**
 * The main thread's end of one engine processor node: typed messages out,
 * typed replies in.
 *
 * A reply crossed from the audio thread as a structured clone, so it is read
 * with the protocol's reader before anyone hears it, and a reply that does not
 * read is logged and dropped rather than acted on: the processor's state is
 * unknown to a listener that cannot say what it was told. The link owns the
 * node it is given, and disconnecting it is part of letting it go.
 *
 * A reply that arrived and could not be received at all, which the port says
 * with `messageerror` and in no other way, is heard as a fault: what the
 * processor said is lost, whether it was a start, an end or its own fault, so
 * what plays is in doubt, and a listener waiting on it would wait for ever.
 */

import type { Logger } from '@audiogubbins/diagnostics';

import type { WorkletNodePort } from '../context/audio-context-port.js';
import {
  FromProcessorKind,
  readFromProcessor,
  type FromProcessor,
  type ToProcessor,
} from '../protocol/processor-messages.js';

/** Hears every reply the processor sends that reads as one. */
export type ReplyListener = (message: FromProcessor) => void;

/** One processor node, spoken to and heard through the protocol. */
export class EngineLink {
  readonly #node: WorkletNodePort;
  readonly #logger: Logger;
  readonly #listeners = new Set<ReplyListener>();
  #disposed = false;

  constructor(node: WorkletNodePort, logger: Logger) {
    this.#node = node;
    this.#logger = logger;
    node.port.addEventListener('message', this.#received);
    node.port.addEventListener('messageerror', this.#undeliverable);
    // A port listened to with `addEventListener` holds its messages until started.
    node.port.start();
  }

  /** Sends a message, transferring the memory named rather than copying it. */
  send(message: ToProcessor, transfer: Transferable[] = []): void {
    if (this.#disposed) {
      // A wiring mistake: a disposed link's node is disconnected and its
      // processor no longer heard.
      throw new Error('This engine link was disposed; its processor is gone.');
    }
    this.#node.port.postMessage(message, transfer);
  }

  /** Hears every reply from now until the answer is called. */
  subscribe(listener: ReplyListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Stops hearing the processor, drops every listener and disconnects the node. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#node.port.removeEventListener('message', this.#received);
    this.#node.port.removeEventListener('messageerror', this.#undeliverable);
    this.#listeners.clear();
    this.#node.disconnect();
  }

  readonly #received = (event: MessageEvent): void => {
    const read = readFromProcessor(event.data);
    if (!read.ok) {
      const [problem] = read.failures;
      this.#logger.error('A reply from the audio processor could not be read, and was dropped.', {
        code: problem.code,
        reason: problem.summary,
      });
      return;
    }
    this.#tell(read.value);
  };

  readonly #undeliverable = (): void => {
    this.#logger.error('A reply from the audio processor could not be received.');
    this.#tell({
      kind: FromProcessorKind.Fault,
      message:
        'A message from the audio processor could not be received, so what it plays is in doubt.',
    });
  };

  #tell(message: FromProcessor): void {
    // A copy, so a listener that unsubscribes while hearing a reply does not
    // make the one after it miss it.
    for (const listener of [...this.#listeners]) listener(message);
  }
}
