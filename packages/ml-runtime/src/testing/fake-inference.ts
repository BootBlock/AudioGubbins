/**
 * A runtime played by a test: the inference port with a model's arithmetic
 * written in TypeScript, for the tests of what runs a model, here and in the
 * packages that do, without the runtime or a worker.
 *
 * It keeps the port's contract as the adapter does, by the same rules: the
 * device's capabilities refuse a session the same way, inputs that do not fit
 * the model are refused the same way, a cancelled call is answered as
 * cancelled and a released session's runs as released. It records the options
 * of every session it opened and how many are still open, so a test can show
 * that what it ran was pinned, or that it let every session go.
 */

import { fail, succeed, type CancellationSignal, type DomainResult } from '@audiogubbins/domain';

import {
  capabilityRefusal,
  type InferenceCapabilities,
  type InferenceExecution,
  type InferenceOptions,
  type RuntimeIdentity,
} from '../inference-options.js';
import {
  cancelled,
  inputRefusal,
  released,
  type InferencePort,
  type InferenceSession,
  type ModelBytes,
} from '../inference-port.js';
import type { Tensor, TensorInfo } from '../tensor.js';

/** A model as the fake runs it: its declared inputs and outputs, and its arithmetic. */
export interface FakeModel {
  readonly inputs: readonly TensorInfo[];
  readonly outputs: readonly TensorInfo[];
  /** The outputs for inputs that fit the declared ones, by output name. */
  run(inputs: ReadonlyMap<string, Tensor>): ReadonlyMap<string, Tensor>;
}

/** A device that offers the runtime everything. */
export const EVERY_CAPABILITY: InferenceCapabilities = {
  fixedWidthSimd: true,
  threads: 8,
  webGpu: true,
};

/** The identity the fake says it is, a runtime no render could have run on. */
export const FAKE_RUNTIME: RuntimeIdentity = {
  name: 'fake-runtime',
  version: '0.0.0',
  webAssemblySha256: '0'.repeat(64),
};

class FakeSession implements InferenceSession {
  readonly inputs: readonly TensorInfo[];
  readonly outputs: readonly TensorInfo[];
  readonly execution: InferenceExecution;
  readonly #model: FakeModel;
  readonly #closed: () => void;
  #released = false;

  constructor(model: FakeModel, execution: InferenceExecution, closed: () => void) {
    this.inputs = model.inputs;
    this.outputs = model.outputs;
    this.execution = execution;
    this.#model = model;
    this.#closed = closed;
  }

  run(
    inputs: ReadonlyMap<string, Tensor>,
    signal?: CancellationSignal,
  ): Promise<DomainResult<ReadonlyMap<string, Tensor>>> {
    if (this.#released) return Promise.resolve(released());
    if (signal?.aborted === true) return Promise.resolve(cancelled());
    const refusal = inputRefusal(this.inputs, inputs);
    if (refusal !== undefined) return Promise.resolve(refusal);
    return Promise.resolve(succeed(this.#model.run(inputs)));
  }

  release(): void {
    if (this.#released) return;
    this.#released = true;
    this.#closed();
  }
}

/** The inference port over a model written in TypeScript. */
export class FakeInference implements InferencePort {
  readonly #model: FakeModel;
  readonly #capabilities: InferenceCapabilities;
  /** The options of every session opened, in order. */
  readonly opened: InferenceOptions[] = [];
  #open = 0;

  constructor(model: FakeModel, capabilities: InferenceCapabilities = EVERY_CAPABILITY) {
    this.#model = model;
    this.#capabilities = capabilities;
  }

  /** How many sessions are open: opened and not yet released. */
  get openSessions(): number {
    return this.#open;
  }

  open(
    _model: ModelBytes,
    options: InferenceOptions,
    signal?: CancellationSignal,
  ): Promise<DomainResult<InferenceSession>> {
    if (signal?.aborted === true) return Promise.resolve(cancelled());
    const refusal = capabilityRefusal(options, this.#capabilities);
    if (refusal !== undefined) return Promise.resolve(fail(refusal));
    this.opened.push(options);
    this.#open += 1;
    const session = new FakeSession(this.#model, { options, runtime: FAKE_RUNTIME }, () => {
      this.#open -= 1;
    });
    return Promise.resolve(succeed(session));
  }
}
