/**
 * The feeder worker: a module the browser loads as a dedicated worker, which
 * reads real-time playback's sources and feeds the audio thread.
 *
 * It only connects the worker's global scope, the channel to the processor each
 * binding brings, and the effect rack that runs an edited sound's chains, to
 * `FeederCore`, which holds everything the feeder does, so that behaviour is
 * tested without a worker. The package is compiled with the DOM's types rather
 * than a worker's, so the scope is typed here by the part of it the worker
 * uses. It is compiled again, with everything it imports, by
 * `scopes/dedicated-worker`, against a worker's definitions alone. A chain it
 * runs itself rather than hear from a render runs a model through the model
 * channel the page connects it by, which its scope hands on before the core
 * reads anything.
 */

import { chainProcessing } from '@audiogubbins/effect-rack';
import { ModelChannel } from '@audiogubbins/ml-runtime';
import { processorTypesWith } from '@audiogubbins/processors';

import { FeederCore } from '../feeder/feeder-core.js';
import { scopeDsp } from '../dsp/dsp-instance.js';
import type { FromFeeder } from '../protocol/feeder-messages.js';

/** The part of a dedicated worker's global scope this module uses. */
interface FeederWorkerScope {
  postMessage(message: FromFeeder): void;
  addEventListener(type: 'message' | 'messageerror', listener: (event: MessageEvent) => void): void;
  setTimeout(callback: () => void, milliseconds: number): number;
  clearTimeout(timer: number): void;
}

const scope: FeederWorkerScope = self;

const models = new ModelChannel(() => new MessageChannel());

/** The feeder's end of the channel to the processor, while it is bound. */
let processor: MessagePort | undefined;

const core: FeederCore = new FeederCore({
  post: (message) => {
    scope.postMessage(message);
  },
  connectProcessor: (port) => {
    if (processor !== undefined) {
      processor.onmessage = null;
      processor.onmessageerror = null;
      processor.close();
    }
    processor = port;
    if (port === undefined) return;
    port.onmessage = (event: MessageEvent<unknown>) => {
      core.receiveFromProcessor(event.data);
    };
    // An answer that could not be received is a count of what the processor
    // holds that is lost, which the feeder would otherwise go on without.
    port.onmessageerror = () => {
      core.processorMessageFailed();
    };
  },
  postToProcessor: (message, transfer) => {
    processor?.postMessage(message, transfer);
  },
  schedule: (callback, milliseconds) => {
    const timer = scope.setTimeout(callback, milliseconds);
    return () => {
      scope.clearTimeout(timer);
    };
  },
  chooseDsp: scopeDsp,
  processing: chainProcessing(processorTypesWith({ inference: models, models })),
});

scope.addEventListener('message', (event) => {
  if (!models.receive(event.data)) core.receive(event.data);
});
// A message that could not be deserialised arrives as this rather than as a
// message, and the main thread would otherwise wait on what it asked for ever.
scope.addEventListener('messageerror', () => {
  core.messageFailed();
});
