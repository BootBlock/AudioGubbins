/**
 * One session of ONNX Runtime Web's, as the inference port's session: the
 * other half of the adapter, beside `onnx-runtime.ts`, which alone imports the
 * runtime and makes the sessions this module serves.
 *
 * It reads the model's inputs and outputs as the runtime describes them,
 * admitting float32 tensors alone and letting go of a session that has any
 * other; it takes runs in turn, as the runtime needs, answering a run that is
 * cancelled or whose session is let go at once while the runtime finishes the
 * run in hand; and it frees the runtime's session once that run ends.
 */

import {
  FailureKind,
  createCancellationSource,
  fail,
  failure,
  succeed,
  type CancellationSignal,
  type DomainResult,
} from '@audiogubbins/domain';

import type { InferenceExecution } from '../inference-options.js';
import {
  cancelled,
  inputRefusal,
  released,
  unlessCancelled,
  type InferenceSession,
} from '../inference-port.js';
import { tensor, type Tensor, type TensorDimension, type TensorInfo } from '../tensor.js';

/** What the runtime says of a model's input or output. */
export type OnnxValueMetadata =
  | { readonly name: string; readonly isTensor: false }
  | {
      readonly name: string;
      readonly isTensor: true;
      readonly type: string;
      readonly shape: readonly (number | string)[];
    };

/** A tensor of the runtime's, which the adapter only hands back to it. */
export interface OnnxTensor {
  readonly dims: readonly number[];
}

/** How the runtime makes a float32 tensor. */
export type OnnxTensorConstructor = new (
  type: 'float32',
  data: Float32Array,
  dims: readonly number[],
) => OnnxTensor;

/** The part of a runtime session the adapter uses. */
export interface OnnxSession {
  readonly inputMetadata: readonly OnnxValueMetadata[];
  readonly outputMetadata: readonly OnnxValueMetadata[];
  run(feeds: Readonly<Record<string, OnnxTensor>>): Promise<Readonly<Record<string, unknown>>>;
  release(): Promise<void>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A declared dimension: a whole length, a name, or the empty name where it gives neither. */
function dimensionOf(dimension: number | string): TensorDimension {
  if (typeof dimension === 'string') return dimension;
  return Number.isSafeInteger(dimension) && dimension >= 0 ? dimension : '';
}

/** The model's inputs or outputs, where every one is a float32 tensor. */
function infoOf(metadata: readonly OnnxValueMetadata[]): readonly TensorInfo[] | undefined {
  const info: TensorInfo[] = [];
  for (const one of metadata) {
    if (!one.isTensor || one.type !== 'float32') return undefined;
    info.push({ name: one.name, dims: one.shape.map(dimensionOf) });
  }
  return info;
}

/** A value the runtime answered, as a float32 tensor in memory of its own. */
function floatTensorOf(value: unknown): DomainResult<Tensor> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  if (!('type' in value) || !('data' in value) || !('dims' in value)) return undefined;
  const { type, data, dims } = value;
  if (type !== 'float32' || !(data instanceof Float32Array) || !Array.isArray(dims)) {
    return undefined;
  }
  const lengths = dims.filter((one): one is number => typeof one === 'number');
  if (lengths.length !== dims.length) return undefined;
  // The runtime copies an output out of its memory, so this is that copy; one
  // over shared memory is copied again, since shared memory cannot be moved.
  const owned =
    data.buffer instanceof ArrayBuffer
      ? new Float32Array(data.buffer, data.byteOffset, data.length)
      : new Float32Array(data);
  return tensor(owned, lengths);
}

/** The model's outputs, by the names it declares, from what the runtime answered. */
function outputsOf(
  declared: readonly TensorInfo[],
  results: Readonly<Record<string, unknown>>,
): DomainResult<ReadonlyMap<string, Tensor>> {
  const outputs = new Map<string, Tensor>();
  for (const { name } of declared) {
    const read = floatTensorOf(results[name]);
    if (read === undefined) {
      return fail(
        failure(
          'inference.output-unsupported',
          FailureKind.Unrecoverable,
          `The model's output ${name} is not a float32 tensor.`,
        ),
      );
    }
    if (!read.ok) return read;
    outputs.set(name, read.value);
  }
  return succeed(outputs);
}

/** A session on the runtime, its runs taken in turn. */
class OnnxSessionAdapter implements InferenceSession {
  readonly inputs: readonly TensorInfo[];
  readonly outputs: readonly TensorInfo[];
  readonly execution: InferenceExecution;
  readonly #session: OnnxSession;
  readonly #tensor: OnnxTensorConstructor;
  readonly #reportFault: (error: unknown) => void;
  /** Cancelled when the session is let go, which answers its waiting runs. */
  readonly #lifetime = createCancellationSource();
  /** The last run asked for, which the next waits for. */
  #turn: Promise<unknown> = Promise.resolve();

  constructor(
    described: Pick<InferenceSession, 'inputs' | 'outputs' | 'execution'>,
    session: OnnxSession,
    makeTensor: OnnxTensorConstructor,
    reportFault: (error: unknown) => void,
  ) {
    this.inputs = described.inputs;
    this.outputs = described.outputs;
    this.execution = described.execution;
    this.#session = session;
    this.#tensor = makeTensor;
    this.#reportFault = reportFault;
  }

  run(
    inputs: ReadonlyMap<string, Tensor>,
    signal?: CancellationSignal,
  ): Promise<DomainResult<ReadonlyMap<string, Tensor>>> {
    if (this.#lifetime.signal.aborted) return Promise.resolve(released());
    if (signal?.aborted === true) return Promise.resolve(cancelled());
    const refusal = inputRefusal(this.inputs, inputs);
    if (refusal !== undefined) return Promise.resolve(refusal);
    const turn = this.#turn.then(() => this.#runNow(inputs, signal));
    this.#turn = turn;
    return unlessCancelled(
      unlessCancelled(turn, this.#lifetime.signal, { answer: released }),
      signal,
    );
  }

  async #runNow(
    inputs: ReadonlyMap<string, Tensor>,
    signal: CancellationSignal | undefined,
  ): Promise<DomainResult<ReadonlyMap<string, Tensor>>> {
    // Answered already, so the runtime is spared a run nobody waits for.
    if (this.#lifetime.signal.aborted || signal?.aborted === true) return cancelled();
    const feeds = Object.fromEntries(
      [...inputs].map(([name, one]) => [name, new this.#tensor('float32', one.data, one.dims)]),
    );
    try {
      return outputsOf(this.outputs, await this.#session.run(feeds));
    } catch (error) {
      // The runtime rejects a run it cannot complete, such as one whose named
      // dimensions disagree; the session itself stays usable.
      return fail(
        failure(
          'inference.run-failed',
          FailureKind.Unrecoverable,
          `The runtime could not run the model: ${messageOf(error)}`,
        ),
      );
    }
  }

  release(): void {
    if (this.#lifetime.signal.aborted) return;
    this.#lifetime.cancel();
    this.#turn = this.#turn.then(() => this.#session.release()).catch(this.#reportFault);
  }
}

/**
 * The port's session over what the runtime made, or why the model is not one
 * the port carries, the runtime's session let go.
 */
export function sessionOver(
  session: OnnxSession,
  makeTensor: OnnxTensorConstructor,
  execution: InferenceExecution,
  reportFault: (error: unknown) => void,
): DomainResult<InferenceSession> {
  const inputs = infoOf(session.inputMetadata);
  const outputs = infoOf(session.outputMetadata);
  if (inputs === undefined || outputs === undefined) {
    session.release().catch(reportFault);
    return fail(
      failure(
        'inference.model-unsupported',
        FailureKind.Unrecoverable,
        'The model has an input or an output that is not a float32 tensor, which no pack needs.',
      ),
    );
  }
  return succeed(
    new OnnxSessionAdapter({ inputs, outputs, execution }, session, makeTensor, reportFault),
  );
}
