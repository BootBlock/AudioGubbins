/**
 * The peak worker: a module the browser loads as a dedicated worker.
 *
 * It only connects the worker's global scope to `PeakWorkerCore`, which holds
 * everything the worker does, so that behaviour is tested without a worker. The
 * package is compiled without any browser's type definitions, so the parts of
 * the scope this module uses are declared here by their shape; the build
 * compiles it again, with everything it imports, by `scopes/dedicated-worker`,
 * against a worker's definitions. It summarises with the reference DSP, which
 * gives the canonical bits without the WebAssembly module a render worker is
 * sent.
 */

import { REFERENCE_DSP } from '@audiogubbins/audio-engine';
import { chainProcessing } from '@audiogubbins/effect-rack';
import { PROCESSOR_TYPES_BY_KEY } from '@audiogubbins/processors';

import type { FromPeakWorker } from '../peak-messages.js';
import { PeakWorkerCore } from '../peak-worker-core.js';

/** The part of a dedicated worker's global scope this module uses. */
interface PeakWorkerScope {
  postMessage(message: FromPeakWorker, options: { transfer: ArrayBuffer[] }): void;
  addEventListener(
    type: 'message' | 'messageerror',
    listener: (event: { readonly data: unknown }) => void,
  ): void;
  reportError(error: unknown): void;
}

/** A channel whose second port's messages arrive at its first. */
interface TurnChannel {
  readonly port1: { onmessage: (() => void) | null };
  readonly port2: { postMessage(message: undefined): void };
}

declare const self: PeakWorkerScope;
declare const MessageChannel: new () => TurnChannel;
declare const performance: { now(): number };

/**
 * A yield to the worker's event loop between chunks, so a request that arrived
 * while a chunk was summarised is read before the next. A message to itself
 * rather than a timer, which a browser clamps to four milliseconds at this
 * depth. The channel is made once, and each yield is answered by one message,
 * in order.
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

const core = new PeakWorkerCore({
  post: (message, transfer) => {
    self.postMessage(message, { transfer: [...transfer] });
  },
  yieldToHost,
  dsp: REFERENCE_DSP,
  processing: chainProcessing(PROCESSOR_TYPES_BY_KEY),
  reportFault: (error) => {
    self.reportError(error);
  },
  now: () => performance.now(),
});

self.addEventListener('message', (event) => {
  core.receive(event.data);
});
// A message that could not be deserialised arrives as this rather than as a
// message, and the page would otherwise wait on its jobs for ever.
self.addEventListener('messageerror', () => {
  core.messageFailed();
});
