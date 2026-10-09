/**
 * The inference worker: a module the browser loads as a dedicated worker.
 *
 * It only connects the worker's global scope to `InferenceWorkerCore`, which
 * holds everything the worker does, and serves it the adapter over ONNX Runtime
 * Web, which imports the runtime on the first session, reading the runtime's
 * WebAssembly from the files base the page started it with, on the worker's own
 * origin. The page sends the setup and each thread's channel to the scope; the
 * threads' messages arrive on their channels. Inference so never runs on the
 * page or in the worklet (ADR-0062). The package is compiled without any
 * browser's type definitions, so the parts of the scope this module uses are
 * declared here by their shape; the build compiles it again, with everything it
 * imports, by `scopes/dedicated-worker`, against a worker's definitions.
 */

import { OnnxRuntimeInference, loadOnnxRuntime } from '../adapter/onnx-runtime.js';
import { OriginRuntimeFiles } from '../adapter/origin-runtime-files.js';
import { InferenceWorkerCore } from '../inference-worker-core.js';

/** The part of a dedicated worker's global scope this module uses. */
interface InferenceWorkerScope {
  readonly location: { readonly origin: string };
  addEventListener(
    type: 'message' | 'messageerror',
    listener: (event: { readonly data: unknown }) => void,
  ): void;
  reportError(error: unknown): void;
}

declare const self: InferenceWorkerScope;

const core = new InferenceWorkerCore({
  serve: (setup) =>
    new OnnxRuntimeInference(setup, {
      load: loadOnnxRuntime,
      files: new OriginRuntimeFiles(setup.filesBase),
      reportFault: (error) => {
        self.reportError(error);
      },
    }),
  origin: self.location.origin,
  reportFault: (error) => {
    self.reportError(error);
  },
});

self.addEventListener('message', (event) => {
  core.receive(event.data);
});
// A message that could not be deserialised arrives as this rather than as a
// message: a setup or a channel lost, which is reported.
self.addEventListener('messageerror', () => {
  core.messageFailed();
});
