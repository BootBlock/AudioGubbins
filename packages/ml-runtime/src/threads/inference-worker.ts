/**
 * The inference worker: a module the browser loads as a dedicated worker.
 *
 * It only connects the worker's global scope to `InferenceWorkerCore`, which
 * holds everything the worker does, and serves it the adapter over ONNX
 * Runtime Web, which imports the runtime on the first session. Inference so
 * never runs on the page or in the worklet (ADR-0062). The package is compiled
 * without any browser's type definitions, so the parts of the scope this
 * module uses are declared here by their shape; the build compiles it again,
 * with everything it imports, by `scopes/dedicated-worker`, against a worker's
 * definitions.
 */

import { ONNX_RUNTIME_BUILDS, OnnxRuntimeInference } from '../adapter/onnx-runtime.js';
import { InferenceWorkerCore } from '../inference-worker-core.js';
import type { FromInferenceWorker } from '../protocol/inference-messages.js';

/** The part of a dedicated worker's global scope this module uses. */
interface InferenceWorkerScope {
  readonly location: { readonly origin: string };
  postMessage(message: FromInferenceWorker, options: { transfer: ArrayBuffer[] }): void;
  addEventListener(
    type: 'message' | 'messageerror',
    listener: (event: { readonly data: unknown }) => void,
  ): void;
  reportError(error: unknown): void;
}

declare const self: InferenceWorkerScope;

const core = new InferenceWorkerCore({
  post: (message, transfer) => {
    self.postMessage(message, { transfer: [...transfer] });
  },
  serve: (setup) =>
    new OnnxRuntimeInference(setup, {
      load: ONNX_RUNTIME_BUILDS,
      reportFault: (error) => {
        self.reportError(error);
      },
    }),
  origin: self.location.origin,
});

self.addEventListener('message', (event) => {
  core.receive(event.data);
});
// A message that could not be deserialised arrives as this rather than as a
// message, and the page would otherwise wait on its calls for ever.
self.addEventListener('messageerror', () => {
  core.messageFailed();
});
