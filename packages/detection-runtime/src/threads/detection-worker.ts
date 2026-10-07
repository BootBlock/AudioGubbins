/**
 * The detection worker: a module the browser loads as a dedicated worker.
 *
 * It only connects the worker's global scope to `DetectionWorkerCore`, which
 * holds everything the worker does, so that behaviour is tested without a
 * worker, and gives it the effect rack an edited sound's chains run on, the
 * assistants and the processor types. The package is compiled without any
 * browser's type definitions, so the parts of the scope this module uses are
 * declared here by their shape; the build compiles it again, with everything it
 * imports, by `scopes/dedicated-worker`, against a worker's definitions. It
 * reads with the reference DSP, which gives the canonical bits without the
 * WebAssembly module a render worker is sent, as the peak worker does. A chain
 * it runs itself rather than read from a render runs a model through the model
 * channel the page connects it by, which its scope hands on before the core
 * reads anything.
 */

import { REFERENCE_DSP } from '@audiogubbins/audio-engine';
import { chainProcessing } from '@audiogubbins/effect-rack';
import { ModelChannel, type ChannelPair } from '@audiogubbins/ml-runtime';
import {
  CLASSIFICATION_ASSISTANT,
  REPAIR_ASSISTANT,
  RESTORATION_ASSISTANT,
  processorTypesWith,
} from '@audiogubbins/processors';

import type { FromDetectionWorker } from '../detection-messages.js';
import { DetectionWorkerCore } from '../detection-worker-core.js';

/** The part of a dedicated worker's global scope this module uses. */
interface DetectionWorkerScope {
  postMessage(message: FromDetectionWorker): void;
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

declare const self: DetectionWorkerScope;
declare const MessageChannel: new () => TurnChannel & ChannelPair;

/**
 * A yield to the worker's event loop between chunks, so a cancellation that
 * arrived while a chunk was heard is read before the next. A message to
 * itself rather than a timer, which a browser clamps to four milliseconds at
 * this depth. The channel is made once, and each yield is answered by one
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
const types = processorTypesWith({ inference: models, models });

const core = new DetectionWorkerCore({
  post: (message) => {
    self.postMessage(message);
  },
  yieldToHost,
  dsp: REFERENCE_DSP,
  processing: chainProcessing(types),
  assistants: [CLASSIFICATION_ASSISTANT, REPAIR_ASSISTANT, RESTORATION_ASSISTANT],
  types,
  reportFault: (error) => {
    self.reportError(error);
  },
});

self.addEventListener('message', (event) => {
  if (!models.receive(event.data)) core.receive(event.data);
});
// A message that could not be deserialised arrives as this rather than as a
// message, and the page would otherwise wait on its detections for ever.
self.addEventListener('messageerror', () => {
  core.messageFailed();
});
