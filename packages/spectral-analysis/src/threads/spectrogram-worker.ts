/**
 * The spectrogram worker: a module the browser loads as a dedicated worker.
 *
 * It only connects the worker's global scope to `SpectrogramWorkerCore`, which
 * holds everything the worker does, so that behaviour is tested without a
 * worker. The package is compiled without any browser's type definitions, so
 * the parts of the scope this module uses are declared here by their shape; the
 * build compiles it again, with everything it imports, by
 * `scopes/dedicated-worker`, against a worker's definitions. It instantiates
 * the DSP module the page delivers, as a render worker does, and runs the
 * reference path where none is delivered or it will not start (ADR-0080). A
 * chain it runs itself rather than read from a render runs a model through the
 * model channel the page connects it by, which its scope hands on before the
 * core reads anything.
 */

import { deliveredDsp } from '@audiogubbins/audio-engine';
import { chainProcessing } from '@audiogubbins/effect-rack';
import { ModelChannel, type ChannelPair } from '@audiogubbins/ml-runtime';
import { processorTypesWith } from '@audiogubbins/processors';

import type { FromSpectrogramWorker } from '../spectrogram-messages.js';
import { SpectrogramWorkerCore } from '../spectrogram-worker-core.js';

/** The part of a dedicated worker's global scope this module uses. */
interface SpectrogramWorkerScope {
  postMessage(message: FromSpectrogramWorker, options: { transfer: ArrayBuffer[] }): void;
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

declare const self: SpectrogramWorkerScope;
declare const MessageChannel: new () => TurnChannel & ChannelPair;
/** The part of the scope's WebAssembly this module uses: an instance of a compiled module. */
declare const WebAssembly: {
  readonly Instance: new (module: object, imports: object) => { readonly exports: unknown };
};

/**
 * A yield to the worker's event loop between chunks, so a want cancelled or a
 * focus moved while a chunk was analysed is read before the next. A message
 * to itself rather than a timer, which a browser clamps to four milliseconds
 * at this depth. The channel is made once, and each yield is answered by one
 * message, in order.
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

const models = new ModelChannel(() => new MessageChannel());

const core = new SpectrogramWorkerCore({
  post: (message, transfer) => {
    self.postMessage(message, { transfer: [...transfer] });
  },
  yieldToHost,
  processing: chainProcessing(processorTypesWith({ inference: models, models })),
  chooseDsp: (delivery) =>
    deliveredDsp(delivery, (module) => new WebAssembly.Instance(module, {}).exports),
  reportFault: (error) => {
    self.reportError(error);
  },
});

self.addEventListener('message', (event) => {
  if (!models.receive(event.data)) core.receive(event.data);
});
// A message that could not be deserialised arrives as this rather than as a
// message, and the page would otherwise wait on its tiles for ever.
self.addEventListener('messageerror', () => {
  core.messageFailed();
});
