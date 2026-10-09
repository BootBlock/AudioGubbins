/**
 * A feeder worker whose feeder is the real `FeederCore`, for testing the main
 * thread's side of playback without a worker, which Node's test environment
 * does not start from a bundler's URL.
 *
 * Every message crosses as a structured clone each way, with its transfers,
 * a microtask after it was posted, and the end of the processor's channel a
 * binding brings is listened to as the worker's module listens to it. Its
 * timers run on the schedule the test gives it, and stop when it is
 * terminated, as a worker's do.
 */

import type { NodeId } from '@audiogubbins/audio-graph';
import type { ChainProcessing, PcmSource } from '@audiogubbins/audio-engine';

import { scopeDsp } from '../dsp/dsp-instance.js';
import { FeederCore } from '../feeder/feeder-core.js';
import type { ToFeeder } from '../protocol/feeder-messages.js';
import type { FeederWorkerEvents, FeederWorkerPort } from '../playback/feeder-link.js';
import type { Schedule } from '../schedule.js';
import { crossingThreads } from '@audiogubbins/domain/testing';
import { FakeMessagePort } from './fake-message-channel.js';
import { NO_CHAIN_PROCESSING } from '@audiogubbins/audio-engine/testing';

/** What a fake feeder is made with. */
export interface FakeFeederOptions {
  readonly schedule: Schedule;
  /** Puts a test's reads in front of each source the feeder makes. */
  readonly readThrough?: (node: NodeId, source: PcmSource) => PcmSource;
  /** How the feeder runs an edited sound's chains; it runs none, by default. */
  readonly processing?: ChainProcessing;
}

/** A feeder worker running the feeder's core, driven by a test. */
export class FakeFeederWorker implements FeederWorkerPort {
  /** Every message the main thread posted, as it was before cloning. */
  readonly received: ToFeeder[] = [];
  /** Every delay the feeder waited for, in order. */
  readonly delays: number[] = [];
  terminated = false;
  readonly #core: FeederCore;
  readonly #cancels = new Set<() => void>();
  readonly #listeners: {
    [TType in keyof FeederWorkerEvents]: Set<(event: FeederWorkerEvents[TType]) => void>;
  } = { message: new Set(), messageerror: new Set(), error: new Set() };
  #processor: MessagePort | undefined;

  constructor(options: FakeFeederOptions) {
    const schedule: Schedule = (callback, milliseconds) => {
      this.delays.push(milliseconds);
      const cancel = options.schedule(() => {
        this.#cancels.delete(cancel);
        if (!this.terminated) callback();
      }, milliseconds);
      this.#cancels.add(cancel);
      return () => {
        this.#cancels.delete(cancel);
        cancel();
      };
    };
    this.#core = new FeederCore({
      post: (message) => {
        const data: unknown = structuredClone(message);
        queueMicrotask(() => {
          if (!this.terminated) this.#dispatch('message', new MessageEvent('message', { data }));
        });
      },
      connectProcessor: (port) => {
        if (this.#processor !== undefined) {
          this.#processor.onmessage = null;
          this.#processor.onmessageerror = null;
          this.#processor.close();
        }
        this.#processor = port;
        if (port === undefined) return;
        port.onmessage = (event: MessageEvent<unknown>) => {
          this.#core.receiveFromProcessor(event.data);
        };
        port.onmessageerror = () => {
          this.#core.processorMessageFailed();
        };
      },
      postToProcessor: (message, transfer) => {
        this.#processor?.postMessage(message, transfer);
      },
      schedule,
      chooseDsp: scopeDsp,
      processing: options.processing ?? NO_CHAIN_PROCESSING,
      ...(options.readThrough === undefined ? {} : { readThrough: options.readThrough }),
    });
  }

  /** The feeder's end of the channel to the processor, while it is bound. */
  get processorPort(): FakeMessagePort | undefined {
    return this.#processor instanceof FakeMessagePort ? this.#processor : undefined;
  }

  /** How many listeners the main thread has left registered. */
  get listening(): number {
    return (
      this.#listeners.message.size + this.#listeners.messageerror.size + this.#listeners.error.size
    );
  }

  postMessage(message: ToFeeder, transfer: Transferable[]): void {
    this.received.push(message);
    if (this.terminated) return;
    const data = crossingThreads(message, transfer);
    queueMicrotask(() => {
      if (!this.terminated) this.#core.receive(data);
    });
  }

  addEventListener<TType extends keyof FeederWorkerEvents>(
    type: TType,
    listener: (event: FeederWorkerEvents[TType]) => void,
  ): void {
    this.#listeners[type].add(listener);
  }

  removeEventListener<TType extends keyof FeederWorkerEvents>(
    type: TType,
    listener: (event: FeederWorkerEvents[TType]) => void,
  ): void {
    this.#listeners[type].delete(listener);
  }

  /** Stops the worker, and every timer it had waiting. */
  terminate(): void {
    this.terminated = true;
    for (const cancel of [...this.#cancels]) cancel();
    this.#cancels.clear();
  }

  /** Raises an error the worker's script threw. */
  fail(message: string): void {
    this.#dispatch('error', new ErrorEvent('error', { message, cancelable: true }));
  }

  /** Says a reply arrived that could not be received. */
  replyFails(): void {
    queueMicrotask(() => {
      this.#dispatch('messageerror', new MessageEvent('messageerror'));
    });
  }

  #dispatch<TType extends keyof FeederWorkerEvents>(
    type: TType,
    event: FeederWorkerEvents[TType],
  ): void {
    for (const listener of [...this.#listeners[type]]) listener(event);
  }
}
