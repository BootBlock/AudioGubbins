/**
 * The render worker: a module the browser loads as a dedicated worker.
 *
 * It only connects the worker's global scope to `RenderWorkerCore`, which
 * holds everything the worker does, so that behaviour is tested without a
 * worker. The package is compiled with the DOM's types rather than a
 * worker's, so the scope is typed here by the part of it the worker uses.
 */

import type { FromRenderWorker } from '../protocol/render-messages.js';
import { RenderWorkerCore } from '../render/render-worker-core.js';

/** The part of a dedicated worker's global scope this module uses. */
interface RenderWorkerScope {
  postMessage(message: FromRenderWorker, options: { transfer: Transferable[] }): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

const scope: RenderWorkerScope = self;

/**
 * A yield to the worker's event loop between chunks, so a `cancel` or a
 * `chunk-taken` that arrived while a chunk rendered is read before the next.
 *
 * A message to itself through a channel rather than `setTimeout(…, 0)`: both
 * queue a task, which is what lets the waiting messages run first, but a
 * browser clamps a timer nested this deeply to at least four milliseconds,
 * which a long render would pay once per chunk for nothing. The channel is
 * made once, and each yield is answered by one message, in order.
 */
const turns = new MessageChannel();
const waiting: (() => void)[] = [];
turns.port1.onmessage = () => {
  waiting.shift()?.();
};

function yieldToHost(): Promise<void> {
  return new Promise<void>((resolve) => {
    waiting.push(resolve);
    turns.port2.postMessage(undefined);
  });
}

const core = new RenderWorkerCore({
  post: (message, transfer) => {
    scope.postMessage(message, { transfer });
  },
  yieldToHost,
});

scope.addEventListener('message', (event) => {
  core.receive(event.data);
});
