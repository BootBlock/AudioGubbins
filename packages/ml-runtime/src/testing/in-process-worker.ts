/**
 * The inference workers played in the test's own thread, for testing the
 * page's host, a thread's client and the worker's core together without a
 * worker, which Node's test environment does not start.
 *
 * The topology is the application's: the host starts a worker with the setup, a
 * client asks for a channel to it, and the worker serves a conversation over
 * the channel. Every message on a channel crosses as it would between threads:
 * as a structured clone, its listed buffers transferred, so a buffer the sender
 * gave up is detached here as it would be there, and delivered a turn of the
 * event loop later. The test can hold the worker's answers back to deliver them
 * later, send an answer of its own, or make a worker fail.
 */

import { crossingThreads } from '@audiogubbins/domain/testing';

import type { ChannelEnd } from '../channel-end.js';
import { channelWorkerPort } from '../channel-worker-port.js';
import {
  InferenceHost,
  type InferenceClient,
  type InferenceThreadPort,
} from '../inference-host.js';
import type { InferenceCapabilities, RuntimeSetup } from '../inference-options.js';
import type { InferencePort } from '../inference-port.js';
import { InferenceWorkerCore } from '../inference-worker-core.js';
import { readToInferenceWorker } from '../protocol/inference-message-reading.js';
import type { ToInferenceThread, ToInferenceWorker } from '../protocol/inference-messages.js';
import { WorkerInference } from '../worker-inference.js';
import { EVERY_CAPABILITY } from './fake-inference.js';

/** The origin the played worker says it was loaded from. */
export const TEST_ORIGIN = 'https://audiogubbins.test';

/** A setup on the test origin, with digests no real runtime has. */
export function testSetup(
  capabilities: InferenceCapabilities = EVERY_CAPABILITY,
  filesBase = `${TEST_ORIGIN}/runtime/`,
): RuntimeSetup {
  return {
    filesBase,
    webAssemblySha256: 'a'.repeat(64),
    capabilities,
  };
}

type Listener = (event: { readonly data: unknown }) => void;

/** One end of a channel in this thread (see the module comment). */
class InProcessEnd implements ChannelEnd {
  other: InProcessEnd | undefined;
  closed = false;
  /** Every message that arrived here, as it arrived. */
  readonly received: unknown[] = [];
  #listener: Listener | undefined;
  #started = false;
  #queue: unknown[] = [];
  /** Messages posted from here held back, while the test holds them. */
  held: unknown[] | undefined;

  postMessage(message: unknown, transfer: readonly object[]): void {
    if (this.closed) return;
    const clone = crossingThreads(message, transfer);
    if (this.held === undefined) this.other?.arrive(clone);
    else this.held.push(clone);
  }

  addEventListener(type: 'message' | 'messageerror', listener: Listener): void {
    if (type === 'message') this.#listener = listener;
  }

  start(): void {
    this.#started = true;
    const queued = this.#queue;
    this.#queue = [];
    for (const value of queued) this.arrive(value);
  }

  close(): void {
    this.closed = true;
  }

  /**
   * Delivers `value` here a turn later, once started and unless this end is
   * closed: as between threads, what was posted before the other end closed
   * still arrives.
   */
  arrive(value: unknown): void {
    if (!this.#started) {
      this.#queue.push(value);
      return;
    }
    setTimeout(() => {
      if (this.closed) return;
      this.received.push(value);
      this.#listener?.({ data: value });
    }, 0);
  }
}

/** A channel in this thread: two ends, each delivering to the other. */
export function inProcessChannel(): readonly [InProcessEnd, InProcessEnd] {
  const one = new InProcessEnd();
  const other = new InProcessEnd();
  one.other = other;
  other.other = one;
  return [one, other];
}

/** An inference worker in the test's thread, as the page's host sees it. */
export class InProcessThread implements InferenceThreadPort {
  readonly core: InferenceWorkerCore;
  terminated = false;
  /** The worker's end of each channel it was connected by, in order. */
  readonly channels: InProcessEnd[] = [];
  /** The kinds of message the page sent the worker's scope, in order. */
  readonly scope: ToInferenceThread['kind'][] = [];
  readonly #errors: ((event: { readonly message: string }) => void)[] = [];

  constructor(serve: (setup: RuntimeSetup) => InferencePort, origin: string) {
    this.core = new InferenceWorkerCore({
      serve,
      origin,
      // As a worker's reported error reaches the page: as an error event.
      reportFault: (error) => {
        this.fail(error.message);
      },
    });
  }

  postMessage(message: ToInferenceThread, _transfer: readonly object[]): void {
    // The channel's end moves to the worker as it is: a clone would be a copy.
    if (message.kind === 'connect' && message.port instanceof InProcessEnd) {
      this.channels.push(message.port);
    }
    setTimeout(() => {
      if (this.terminated) return;
      this.scope.push(message.kind);
      this.core.receive(message);
    }, 0);
  }

  addEventListener(_type: 'error', listener: (event: { readonly message: string }) => void): void {
    this.#errors.push(listener);
  }

  terminate(): void {
    this.terminated = true;
    for (const channel of this.channels) channel.close();
  }

  /** Fails the worker as an error its script did not catch would. */
  fail(reason: string): void {
    setTimeout(() => {
      if (this.terminated) return;
      for (const listener of this.#errors) listener({ message: reason });
    }, 0);
  }

  /** The kinds of message the worker received over its channels, in order. */
  get kinds(): readonly ToInferenceWorker['kind'][] {
    return this.channels.flatMap((channel) =>
      channel.received.flatMap((value) => {
        const read = readToInferenceWorker(value);
        return read.ok ? [read.value.kind] : [];
      }),
    );
  }

  /** Holds the worker's answers on every channel back until {@link deliverHeld}. */
  holdAnswers(): void {
    for (const channel of this.channels) channel.held ??= [];
  }

  /** Delivers the answers held back, in order, and holds no more. */
  deliverHeld(): void {
    for (const channel of this.channels) {
      const held = channel.held ?? [];
      channel.held = undefined;
      for (const value of held) channel.other?.arrive(value);
    }
  }

  /** Delivers a value on the latest channel as though the worker had sent it. */
  answer(value: unknown): void {
    this.channels.at(-1)?.other?.arrive(value);
  }
}

/** The inference workers played in this thread, and a thread's client of them. */
export interface InProcessInference {
  readonly inference: WorkerInference;
  readonly host: InferenceHost;
  readonly client: InferenceClient;
  /** Each worker the host started, in order. */
  readonly threads: readonly InProcessThread[];
}

/**
 * The inference port a thread holds, over workers played in this thread that
 * serve the port `serve` makes from the setup (see the module comment).
 */
export function inProcessInference(
  serve: (setup: RuntimeSetup) => InferencePort,
  setup: RuntimeSetup = testSetup(),
  origin = TEST_ORIGIN,
): InProcessInference {
  const threads: InProcessThread[] = [];
  const host = new InferenceHost({
    createWorker: () => {
      const thread = new InProcessThread(serve, origin);
      threads.push(thread);
      return thread;
    },
    setup,
  });
  // Told of a failure only once a worker has started, by when the client is made.
  const client = host.client((reason) => {
    inference.failed(reason);
  });
  const inference = new WorkerInference({
    capabilities: setup.capabilities,
    connect: () => {
      const [mine, theirs] = inProcessChannel();
      client.connect(theirs);
      return channelWorkerPort(mine);
    },
  });
  return { inference, host, client, threads };
}
