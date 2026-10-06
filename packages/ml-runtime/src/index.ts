/**
 * The public contract of AudioGubbins local inference (ADR-0062).
 *
 * The inference port a machine-learning processor runs a model through, the
 * options that pin a final render's session or let a preview run faster, the
 * identity of the runtime build a render ran on, and the port's client over
 * the inference workers. The adapter over ONNX Runtime Web is no part of it:
 * it runs only in the worker, whose module is `./threads/inference-worker`,
 * for the application to give the bundler, so nothing that imports this entry
 * carries the runtime. The worker's behaviour is `InferenceWorkerCore`, tested
 * without a worker.
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
  type RuntimeIdentity,
  type RuntimeSetup,
} from './inference-options.js';

export { type InferencePort, type InferenceSession, type ModelBytes } from './inference-port.js';

export { type InferenceWorkerPort, WorkerInference } from './worker-inference.js';
