/**
 * The preview worker: a module the browser loads as a dedicated worker, which
 * makes and keeps the cached preview renders every worker that reads edited
 * sound reads (ADR-0061).
 *
 * It only connects the worker's global scope, and the effect rack that runs an
 * edited sound's chains, to `PreviewWorkerCore`, which holds everything the
 * worker does, so that behaviour is tested without a worker. The package is
 * compiled with the DOM's types rather than a worker's, so the scope is typed
 * here by the part of it the worker uses. It is compiled again, with
 * everything it imports, by `scopes/dedicated-worker`, against a worker's
 * definitions alone. It renders with the reference DSP, which gives the
 * canonical bits without the WebAssembly module a render worker is sent.
 */

import { REFERENCE_DSP } from '@audiogubbins/audio-engine';
import { chainProcessing } from '@audiogubbins/effect-rack';
import { PROCESSOR_TYPES_BY_KEY } from '@audiogubbins/processors';

import { PreviewWorkerCore } from '../preview/preview-worker-core.js';
import type { FromPreviewWorker } from '../protocol/preview-worker-messages.js';

/** The part of a dedicated worker's global scope this module uses. */
interface PreviewWorkerScope {
  postMessage(message: FromPreviewWorker): void;
  addEventListener(type: 'message' | 'messageerror', listener: (event: MessageEvent) => void): void;
  setTimeout(callback: () => void, milliseconds: number): number;
  clearTimeout(timer: number): void;
  reportError(error: unknown): void;
}

const scope: PreviewWorkerScope = self;

/**
 * The most the renders kept may take: 512 MiB, about 23 minutes of stereo at
 * 48 kHz, so a long preview plays from memory while a device with a few
 * gigabytes keeps room for the page and the other workers. A longer render
 * is declined, and its reader runs the chain itself.
 */
const PREVIEW_CACHE_BYTES = 512 * 2 ** 20;

/**
 * Renders made at once: two, so a waveform's render does not hold up the
 * render playback waits on, and no more, since each runs a chain flat out on
 * this one thread.
 */
const PREVIEW_CONCURRENCY = 2;

const core = new PreviewWorkerCore({
  post: (message) => {
    scope.postMessage(message);
  },
  schedule: (callback, milliseconds) => {
    const timer = scope.setTimeout(callback, milliseconds);
    return () => {
      scope.clearTimeout(timer);
    };
  },
  processing: chainProcessing(PROCESSOR_TYPES_BY_KEY),
  dsp: REFERENCE_DSP,
  bound: PREVIEW_CACHE_BYTES,
  concurrency: PREVIEW_CONCURRENCY,
  reportFault: (error) => {
    scope.reportError(error);
  },
});

scope.addEventListener('message', (event) => {
  core.receive(event.data);
});
// A message that could not be deserialised is a connection lost on the way,
// whose worker would wait on its renders for ever: it is a fault to report.
scope.addEventListener('messageerror', () => {
  scope.reportError(new Error('A message to the preview worker could not be read.'));
});
