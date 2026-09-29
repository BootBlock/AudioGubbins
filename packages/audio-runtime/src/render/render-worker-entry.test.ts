import { afterEach, describe, expect, it, vi } from 'vitest';

import { FromRenderWorkerKind, type FromRenderWorker } from '../protocol/render-messages.js';

type Listener = (event: MessageEvent) => void;

/** A dedicated worker's global scope, as far as the worker's module reaches into it. */
class FakeWorkerScope {
  readonly posted: FromRenderWorker[] = [];
  readonly #listeners = new Map<string, Listener[]>();

  postMessage(message: FromRenderWorker): void {
    this.posted.push(message);
  }

  addEventListener(type: string, listener: Listener): void {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
  }

  dispatch(type: string): void {
    for (const listener of this.#listeners.get(type) ?? []) listener(new MessageEvent(type));
  }
}

describe('the render worker’s module', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('answers a message that could not be received with a refusal the host fails the job on', async () => {
    const scope = new FakeWorkerScope();
    vi.stubGlobal('self', scope);
    vi.resetModules();
    await import('../threads/render-worker.js');

    scope.dispatch('messageerror');

    expect(scope.posted).toEqual([
      expect.objectContaining({
        kind: FromRenderWorkerKind.Refused,
        failures: [expect.objectContaining({ code: 'protocol.render-message-unreceivable' })],
      }),
    ]);
  });
});
