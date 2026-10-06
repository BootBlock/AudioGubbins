/**
 * An inference worker played in the test's own thread, for testing the page's
 * client and the worker's core together without a worker, which Node's test
 * environment does not start.
 *
 * Every message crosses as a worker's does: as a structured clone, its listed
 * buffers transferred, so a buffer the sender gave up is detached here as it
 * would be there, and delivered a turn of the event loop later. The core
 * serves whatever port the test makes from the setup. The test can hold the
 * worker's answers back to deliver them later, send an answer of its own, or
 * make the worker fail.
 */

import type { InferencePort } from '../inference-port.js';
import type { RuntimeSetup } from '../inference-options.js';
import { InferenceWorkerCore } from '../inference-worker-core.js';
import type { ToInferenceWorker } from '../protocol/inference-messages.js';
import type { InferenceWorkerPort } from '../worker-inference.js';

/** The origin the played worker says it was loaded from. */
export const TEST_ORIGIN = 'https://audiogubbins.test';

/** A worker in the test's thread whose answers and faults the test can steer. */
export class InProcessWorker implements InferenceWorkerPort {
  /** Every message the page sent, as the worker received it. */
  readonly received: ToInferenceWorker[] = [];
  terminated = false;
  readonly #core: InferenceWorkerCore;
  #onMessage: ((value: unknown) => void) | undefined;
  #onFault: ((reason: string) => void) | undefined;
  /** Answers held back, while the test holds them. */
  #held: unknown[] | undefined;

  constructor(serve: (setup: RuntimeSetup) => InferencePort, origin = TEST_ORIGIN) {
    this.#core = new InferenceWorkerCore({
      post: (message, transfer) => {
        const clone = structuredClone(message, { transfer: [...transfer] });
        if (this.#held === undefined) this.#deliver(clone);
        else this.#held.push(clone);
      },
      serve,
      origin,
    });
  }

  post(message: ToInferenceWorker, transfer: readonly ArrayBuffer[]): void {
    const clone = structuredClone(message, { transfer: [...transfer] });
    setTimeout(() => {
      if (this.terminated) return;
      this.received.push(clone);
      this.#core.receive(clone);
    }, 0);
  }

  listen(onMessage: (value: unknown) => void, onFault: (reason: string) => void): void {
    this.#onMessage = onMessage;
    this.#onFault = onFault;
  }

  terminate(): void {
    this.terminated = true;
  }

  /** The kinds of message the worker received, in order. */
  get kinds(): readonly ToInferenceWorker['kind'][] {
    return this.received.map((message) => message.kind);
  }

  /** Holds the worker's answers back until {@link deliverHeld}. */
  holdAnswers(): void {
    this.#held ??= [];
  }

  /** Delivers the answers held back, in order, and holds no more. */
  deliverHeld(): void {
    const held = this.#held ?? [];
    this.#held = undefined;
    for (const value of held) this.#deliver(value);
  }

  /** Delivers a value to the page as though the worker had sent it, held or not. */
  answer(value: unknown): void {
    this.#deliver(value);
  }

  /** Fails the worker as an error its script did not catch would. */
  fail(reason: string): void {
    this.#onFault?.(reason);
  }

  #deliver(value: unknown): void {
    setTimeout(() => {
      if (!this.terminated) this.#onMessage?.(value);
    }, 0);
  }
}
