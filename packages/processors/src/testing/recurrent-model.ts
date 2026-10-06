/**
 * A machine-learning processor made for the tests of the shared framework: a
 * model, run by the fake runtime, whose every output frame carries the frames
 * before it within its run, `y[s] = x[s] + y[s − 1] / 2` from zero at each
 * run's start, as a recurrent network carries its state. Its stream runs it in
 * the chunks of a schedule over each channel on its own, so where the runs are
 * cut and joined shows in its output, and a test can work out by hand what any
 * stream must give.
 *
 * It reaches no Node module, so the packages that run chains can take it: its
 * file's hashes are constants, which this package's tests hold to its bytes.
 */

import {
  ProcessorCategory,
  succeed,
  type CancellationSignal,
  type DomainResult,
  type SampleRate,
} from '@audiogubbins/domain';
import { GraphOptimisation, InferenceMode, tensor } from '@audiogubbins/ml-runtime';
import { FAKE_RUNTIME, FakeInference, type FakeModel } from '@audiogubbins/ml-runtime/testing';

import type { ChunkSchedule, ScheduledRun } from '../ml/chunk-schedule.js';
import type { ModelDefinition } from '../ml/model-definition.js';
import type { ModelOutput, ModelStream } from '../ml/model-pass.js';
import type { ProcessorType } from '../framework/processor-type.js';
import { ModelUnavailability, modelUnavailable, type ModelLibrary } from '../ml/model-library.js';
import { modelDescriptor, modelProcessorType, type ModelProcessor } from '../ml/model-processor.js';
import type { ModelSessions } from '../ml/model-sessions.js';
import { ScheduledInput } from '../ml/scheduled-input.js';

/** The model's file: bytes the fake runtime never reads, named by their hash. */
export const RECURRENT_MODEL_BYTES = new Uint8Array([0x6d, 0x6f, 0x64, 0x65, 0x6c]);
export const RECURRENT_MODEL_SHA256 =
  '9372c470eeadd5ecd9c3c74c2b3cb633f8e2f2fad799250a0f70d652b6b825e4';
export const RECURRENT_MODEL_PATH = 'model.onnx';

/** `modelHashOf` the pack's listing: the model's file is all it holds. */
export const RECURRENT_MODEL_HASH =
  '44df626123bf14c3103a3c35be9cf5c4d7dcf161f6816b53f5dcf69e421f9986';
export const RECURRENT_PACK = 'test-recurrence';
export const RECURRENT_VERSION = '1.0.0';

/** The schedule the stream runs the model in, in frames at the model's rate. */
const RECURRENT_SCHEDULE: ChunkSchedule = {
  chunk: 256,
  before: 64,
  after: 0,
  firstChunk: 256,
};

/** The recurrence the model computes over one run, in single precision as a graph would. */
export function recurrence(input: Float32Array): Float32Array<ArrayBuffer> {
  const output = new Float32Array(input.length);
  let previous = 0;
  for (const [index, sample] of input.entries()) {
    previous = Math.fround(sample + previous / 2);
    output[index] = previous;
  }
  return output;
}

/** The model as the fake runtime runs it: `x` [1, S] to `y` [1, S]. */
export const RECURRENT_MODEL: FakeModel = {
  inputs: [{ name: 'x', dims: [1, 'S'] }],
  outputs: [{ name: 'y', dims: [1, 'S'] }],
  run: (inputs) => {
    const x = inputs.get('x');
    if (x === undefined) throw new Error('The model was run without its input.');
    return new Map([['y', { data: recurrence(x.data), dims: x.dims }]]);
  },
};

/** The model's definition at `sampleRate`, on the runtime `runtimeHash` names. */
export function recurrentDefinition(
  sampleRate: SampleRate,
  runtimeHash = FAKE_RUNTIME.webAssemblySha256,
): ModelDefinition {
  return {
    identity: {
      pack: RECURRENT_PACK,
      version: RECURRENT_VERSION,
      modelHash: RECURRENT_MODEL_HASH,
      runtimeHash,
    },
    files: [{ path: RECURRENT_MODEL_PATH, sha256: RECURRENT_MODEL_SHA256 }],
    sampleRate,
    inference: { kind: InferenceMode.Pinned, graphOptimisation: GraphOptimisation.Extended },
  };
}

/** Runs the model over each channel in the schedule's runs, keeping each run's chunk. */
class RecurrentStream implements ModelStream {
  readonly #sessions: ModelSessions;
  readonly #emit: ModelOutput;
  readonly #input: ScheduledInput;

  constructor(sessions: ModelSessions, channels: number, emit: ModelOutput) {
    this.#sessions = sessions;
    this.#emit = emit;
    this.#input = new ScheduledInput(RECURRENT_SCHEDULE, channels);
  }

  async hear(input: readonly Float32Array[], frames: number, signal?: CancellationSignal) {
    return await this.#input.hear(input, frames, (run, channels) =>
      this.#run(run, channels, signal),
    );
  }

  async end(signal?: CancellationSignal) {
    return await this.#input.end((run, channels) => this.#run(run, channels, signal));
  }

  release(): void {
    // The scheduled input's arrays go with the stream; nothing else is held.
  }

  async #run(
    run: ScheduledRun,
    channels: readonly Float32Array[],
    signal: CancellationSignal | undefined,
  ): Promise<DomainResult<void>> {
    const { from, count } = this.#input.part(run);
    const kept: Float32Array[] = [];
    for (const samples of channels) {
      const input = tensor(samples.slice(), [1, run.length]);
      if (!input.ok) return input;
      const ran = await this.#sessions
        .of(RECURRENT_MODEL_PATH)
        .run(new Map([['x', input.value]]), signal);
      if (!ran.ok) return ran;
      kept.push(ran.value.get('y')?.data.slice(from, from + count) ?? new Float32Array(count));
    }
    await this.#emit(kept, count);
    return succeed(undefined);
  }
}

/** The test processor over the model `definition` names. */
export function recurrentProcessor(definition: ModelDefinition): ModelProcessor {
  return {
    descriptor: modelDescriptor({
      typeKey: 'test-recurrence',
      label: 'Test recurrence',
      category: ProcessorCategory.Restoration,
      implementation: 1,
      parameterVersion: 1,
      model: definition,
      parameters: [],
    }),
    model: definition,
    stream: (sessions, run, emit) => new RecurrentStream(sessions, run.input.roles.length, emit),
  };
}

/** A library that holds the model's one file, and no other. */
const RECURRENT_LIBRARY: ModelLibrary = {
  file: (pack, version, path) =>
    Promise.resolve(
      pack === RECURRENT_PACK && version === RECURRENT_VERSION && path === RECURRENT_MODEL_PATH
        ? succeed({ bytes: RECURRENT_MODEL_BYTES.slice(), sha256: RECURRENT_MODEL_SHA256 })
        : modelUnavailable(
            ModelUnavailability.RequiredUnavailable,
            `No installed pack holds ${path} of ${pack} ${version}.`,
            { pack, version, path },
          ),
    ),
};

/**
 * The test processor's type at `sampleRate`, its model's file read from
 * memory and run by the fake runtime, for a test that runs it in a chain.
 */
export function recurrentType(sampleRate: SampleRate): ProcessorType {
  return modelProcessorType(recurrentProcessor(recurrentDefinition(sampleRate)), {
    inference: new FakeInference(RECURRENT_MODEL),
    models: RECURRENT_LIBRARY,
  });
}
