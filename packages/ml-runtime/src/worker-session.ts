/**
 * A session the inference worker holds, as the thread that opened it holds
 * it (`worker-inference.ts`): its model's inputs, outputs and execution, its
 * runs sent through the connection it was opened over, and its release.
 *
 * A run whose tensors do not describe their data, or do not fit the model, is
 * refused here, so a caller's mistake answers the caller rather than reaching
 * the worker as a message it would refuse whole.
 */

import type { CancellationSignal, DomainFailureResult, DomainResult } from '@audiogubbins/domain';

import type { InferenceExecution } from './inference-options.js';
import { inputRefusal, released, type InferenceSession } from './inference-port.js';
import { tensor, type Tensor, type TensorInfo } from './tensor.js';

/** What a session sends through the connection it was opened over. */
export interface SessionCalls {
  run(
    session: number,
    inputs: ReadonlyMap<string, Tensor>,
    signal: CancellationSignal | undefined,
  ): Promise<DomainResult<ReadonlyMap<string, Tensor>>>;
  release(session: number): void;
}

/** Why `inputs` cannot be sent: a tensor whose dimensions miss its data, or a misfit to the model. */
function inputsRefusal(
  declared: readonly TensorInfo[],
  inputs: ReadonlyMap<string, Tensor>,
): DomainFailureResult | undefined {
  for (const one of inputs.values()) {
    const read = tensor(one.data, one.dims);
    if (!read.ok) return read;
  }
  return inputRefusal(declared, inputs);
}

/** A session in a worker, known there by the call that opened it. */
export class WorkerSession implements InferenceSession {
  readonly inputs: readonly TensorInfo[];
  readonly outputs: readonly TensorInfo[];
  readonly execution: InferenceExecution;
  readonly #id: number;
  readonly #calls: SessionCalls;
  #released = false;

  constructor(
    id: number,
    described: Pick<InferenceSession, 'inputs' | 'outputs' | 'execution'>,
    calls: SessionCalls,
  ) {
    this.#id = id;
    this.inputs = described.inputs;
    this.outputs = described.outputs;
    this.execution = described.execution;
    this.#calls = calls;
  }

  run(
    inputs: ReadonlyMap<string, Tensor>,
    signal?: CancellationSignal,
  ): Promise<DomainResult<ReadonlyMap<string, Tensor>>> {
    if (this.#released) return Promise.resolve(released());
    const refusal = inputsRefusal(this.inputs, inputs);
    if (refusal !== undefined) return Promise.resolve(refusal);
    return this.#calls.run(this.#id, inputs, signal);
  }

  release(): void {
    if (this.#released) return;
    this.#released = true;
    this.#calls.release(this.#id);
  }
}
