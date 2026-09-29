/**
 * A render worker played by a test, for testing the main thread's side of a
 * render without a worker, which jsdom does not have.
 *
 * It keeps every message it is sent, with the buffers transferred, and raises
 * the events a worker raises when the test says.
 */

import type { FromRenderWorker, ToRenderWorker } from '../protocol/render-messages.js';
import type { RenderWorkerEvents, RenderWorkerPort } from '../render/worker-render.js';

/** A message the worker was sent, with what was transferred with it. */
interface ReceivedMessage {
  readonly message: ToRenderWorker;
  readonly transfer: Transferable[];
}

/** A render worker whose replies and faults the test raises. */
export class FakeRenderWorker implements RenderWorkerPort {
  readonly received: ReceivedMessage[] = [];
  terminated = false;
  readonly #listeners: {
    [TType in keyof RenderWorkerEvents]: Set<(event: RenderWorkerEvents[TType]) => void>;
  } = { message: new Set(), messageerror: new Set(), error: new Set() };

  postMessage(message: ToRenderWorker, transfer: Transferable[]): void {
    this.received.push({ message, transfer });
  }

  addEventListener<TType extends keyof RenderWorkerEvents>(
    type: TType,
    listener: (event: RenderWorkerEvents[TType]) => void,
  ): void {
    this.#listeners[type].add(listener);
  }

  removeEventListener<TType extends keyof RenderWorkerEvents>(
    type: TType,
    listener: (event: RenderWorkerEvents[TType]) => void,
  ): void {
    this.#listeners[type].delete(listener);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** How many listeners the host has left registered. */
  get listening(): number {
    return (
      this.#listeners.message.size + this.#listeners.messageerror.size + this.#listeners.error.size
    );
  }

  /** The kinds of message the worker was sent, in order. */
  get kinds(): readonly ToRenderWorker['kind'][] {
    return this.received.map(({ message }) => message.kind);
  }

  /** The job the worker was given, by its first message. */
  get jobId(): string {
    return this.received[0]?.message.jobId ?? '';
  }

  /** Delivers a reply, or any value in its place, as a structured clone arrives. */
  reply(message: FromRenderWorker | Readonly<Record<string, unknown>>): void {
    const event = new MessageEvent('message', { data: message });
    for (const listener of this.#listeners.message) listener(event);
  }

  /** Raises an error the worker's script threw, answering the event for its default. */
  fail(message: string): ErrorEvent {
    const event = new ErrorEvent('error', { message, cancelable: true });
    for (const listener of this.#listeners.error) listener(event);
    return event;
  }

  /** Raises a reply that could not be deserialised. */
  unreadable(): void {
    const event = new MessageEvent('messageerror');
    for (const listener of this.#listeners.messageerror) listener(event);
  }
}
