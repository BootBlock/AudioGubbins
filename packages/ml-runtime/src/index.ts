/**
 * The public contract of AudioGubbins local inference (ADR-0062).
 *
 * The inference port a machine-learning processor runs a model through, the
 * options that pin a final render's session or let a preview run faster, the
 * identity of the runtime build a render ran on, the runtime's WebAssembly
 * files the application serves, the port's client over the inference workers
 * that a thread running models holds, the page's end of those workers, one per
 * runtime configuration for the whole application, and the model channel
 * between the page and each thread that runs chains, over which the thread
 * reaches the workers and the installed packs' files. The adapter over ONNX
 * Runtime Web is no part of it: it runs only in the worker, whose module is
 * `./threads/inference-worker`, for the application to give the bundler, so
 * nothing that imports this entry carries the runtime. The worker's behaviour
 * is `InferenceWorkerCore`, tested without a worker.
 */

export { type Tensor, type TensorDimension, type TensorInfo, tensor } from './tensor.js';

export {
  GraphOptimisation,
  type InferenceCapabilities,
  type InferenceExecution,
  InferenceMode,
  type InferenceOptions,
  type PreviewAccelerator,
  PreviewAcceleratorKind,
  RuntimeBuild,
  type RuntimeConfiguration,
  type RuntimeIdentity,
  type RuntimeSetup,
} from './inference-options.js';

export { RUNTIME_WEBASSEMBLY_FILES } from './runtime-files.js';

export { type InferencePort, type InferenceSession, type ModelBytes } from './inference-port.js';

export { type InferenceWorkerPort, WorkerInference } from './worker-inference.js';

export { type ChannelEnd } from './channel-end.js';

export {
  type InferenceClient,
  type InferenceFailed,
  InferenceHost,
  type InferenceHostOptions,
  type InferenceThreadPort,
} from './inference-host.js';

export { type ChannelPair, ModelChannel, type ModelFileRead } from './model-channel.js';
export {
  type ModelFileReader,
  type ModelThread,
  ModelThreads,
  type ModelThreadsOptions,
} from './model-threads.js';
