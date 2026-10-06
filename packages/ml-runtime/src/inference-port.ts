/**
 * The inference port: what a machine-learning processor runs a model through
 * (ADR-0062).
 *
 * The port knows no browser global and no runtime. The adapter over ONNX
 * Runtime Web implements it where the runtime runs, the worker's client
 * implements it on the other side of a thread, and the fake implements it for
 * tests. Every failure is answered as a `DomainResult` whose code begins
 * `inference.`, with a sentence saying why; nothing is thrown across it, a
 * cancellation included.
 */

import {
  FailureKind,
  fail,
  failure,
  type CancellationSignal,
  type DomainFailureResult,
  type DomainResult,
} from '@audiogubbins/domain';

import type { InferenceExecution, InferenceOptions } from './inference-options.js';
import type { Tensor, TensorInfo } from './tensor.js';

/** A model's ONNX bytes, in memory of their own. */
export type ModelBytes = Uint8Array<ArrayBuffer>;

/** Opens sessions on models. */
export interface InferencePort {
  /**
   * A session on `model`, run as `options` say, or why there is none. The
   * model's bytes are read, never kept or taken: the caller may open it again.
   */
  open(
    model: ModelBytes,
    options: InferenceOptions,
    signal?: CancellationSignal,
  ): Promise<DomainResult<InferenceSession>>;
}

/** A model loaded into the runtime. */
export interface InferenceSession {
  /** The model's inputs, in its order, with the dimensions it declares. */
  readonly inputs: readonly TensorInfo[];
  /** The model's outputs, in its order, with the dimensions it declares. */
  readonly outputs: readonly TensorInfo[];
  /** What the session runs on, so a preview can say it is one. */
  readonly execution: InferenceExecution;

  /**
   * The model's outputs for `inputs`, one by each input name the model
   * declares, or why there are none. The inputs' data is the port's from the
   * call: a worker takes its buffers rather than copying them, so a caller
   * reads none of them afterwards. Runs on one session are taken in turn.
   */
  run(
    inputs: ReadonlyMap<string, Tensor>,
    signal?: CancellationSignal,
  ): Promise<DomainResult<ReadonlyMap<string, Tensor>>>;

  /**
   * Lets the session go. A run not yet answered is answered as released, and
   * the runtime frees the model once the run it is in ends. Releasing twice
   * does nothing.
   */
  release(): void;
}

/** The answer to work whose signal was cancelled. */
export function cancelled(): DomainFailureResult {
  return fail(failure('inference.cancelled', FailureKind.Rejected, 'The inference was cancelled.'));
}

/** The answer to a run on a session that has been let go. */
export function released(): DomainFailureResult {
  return fail(
    failure(
      'inference.session-released',
      FailureKind.Conflict,
      'The inference session was released before the run was answered.',
    ),
  );
}

/**
 * `work`'s answer, or `answer`'s as soon as `signal` is cancelled, whichever
 * comes first. The work runs on, since the runtime cannot stop a model part
 * way; where it is outrun and succeeds after all, its value is handed to
 * `discard`, so a session opened for a cancelled caller is still let go.
 */
export function unlessCancelled<TValue>(
  work: Promise<DomainResult<TValue>>,
  signal: CancellationSignal | undefined,
  options: {
    readonly answer?: () => DomainFailureResult;
    readonly discard?: (value: TValue) => void;
  } = {},
): Promise<DomainResult<TValue>> {
  if (signal === undefined) return work;
  const answer = options.answer ?? cancelled;
  const late = (result: DomainResult<TValue>): void => {
    if (result.ok) options.discard?.(result.value);
  };
  if (signal.aborted) {
    void work.then(late);
    return Promise.resolve(answer());
  }
  let outrun = false;
  let abort = (): void => undefined;
  const cancelledFirst = new Promise<DomainResult<TValue>>((resolve) => {
    abort = () => {
      outrun = true;
      resolve(answer());
    };
    signal.addEventListener('abort', abort, { once: true });
  });
  const finished = work
    .finally(() => {
      signal.removeEventListener('abort', abort);
    })
    .then((result) => {
      if (outrun) late(result);
      return result;
    });
  return Promise.race([finished, cancelledFirst]);
}

/** Whether `dims` fit what a model declares: the same rank, and each fixed length met. */
function fits(dims: readonly number[], declared: TensorInfo['dims']): boolean {
  return (
    dims.length === declared.length &&
    dims.every((one, index) => {
      const wanted = declared[index];
      return typeof wanted !== 'number' || wanted === one;
    })
  );
}

/**
 * Why `inputs` cannot be run on a model that declares `declared`, or
 * `undefined` where they can: one tensor for each input the model names and
 * none it does not, each of the rank it declares and the lengths it fixes.
 */
export function inputRefusal(
  declared: readonly TensorInfo[],
  inputs: ReadonlyMap<string, Tensor>,
): DomainFailureResult | undefined {
  const problems = [
    ...declared
      .filter((info) => !inputs.has(info.name))
      .map((info) => `The model's input ${info.name} was not given.`),
    ...[...inputs.keys()]
      .filter((name) => !declared.some((info) => info.name === name))
      .map((name) => `The model has no input ${name}.`),
    ...declared.flatMap((info) => {
      const given = inputs.get(info.name);
      return given === undefined || fits(given.dims, info.dims)
        ? []
        : [
            `The model's input ${info.name} is ${info.dims.map(String).join(' by ')}, not ${given.dims.join(' by ')}.`,
          ];
    }),
  ];
  const [first, ...rest] = problems.map((summary) =>
    failure('inference.input-mismatch', FailureKind.Rejected, summary),
  );
  return first === undefined ? undefined : fail(first, ...rest);
}
