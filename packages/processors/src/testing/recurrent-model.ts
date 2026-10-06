/**
 * A machine-learning processor made for the tests of the shared framework: a
 * model, run by the fake runtime, whose every output frame carries the frames
 * before it within its run, `y[s] = x[s] + y[s − 1] / 2` from zero at each
 * run's start, as a recurrent network carries its state. Its stream runs it in
 * the chunks of a schedule over each channel on its own, so where the runs are
 * cut and joined shows in its output, and a test can work out by hand what any
 * stream must give.
 */

import {
  DeterminismClass,
  ProcessorCategory,
  ZERO_SAMPLES,
  succeed,
  type CancellationSignal,
  type DomainResult,
  type ProcessorDescriptor,
  type SampleRate,
} from '@audiogubbins/domain';
import { GraphOptimisation, InferenceMode, tensor } from '@audiogubbins/ml-runtime';
import { FAKE_RUNTIME, type FakeModel } from '@audiogubbins/ml-runtime/testing';

import { scheduledRun, type ChunkSchedule } from '../ml/chunk-schedule.js';
import { CANONICAL_RESAMPLER_VERSION, type ModelDefinition } from '../ml/model-definition.js';
import type { ModelOutput, ModelStream } from '../ml/model-pass.js';
import type { ModelProcessor } from '../ml/model-processor.js';
import type { ModelSessions } from '../ml/model-sessions.js';
import { sha256Of } from './model-services.js';

/** The model's file: bytes the fake runtime never reads, named by their hash. */
export const RECURRENT_MODEL_BYTES = new Uint8Array([0x6d, 0x6f, 0x64, 0x65, 0x6c]);
export const RECURRENT_MODEL_PATH = 'model.onnx';
export const RECURRENT_PACK = 'test-recurrence';
export const RECURRENT_VERSION = '1.0.0';

/** The schedule the stream runs the model in, in frames at the model's rate. */
const RECURRENT_SCHEDULE: ChunkSchedule = { chunk: 256, warmUp: 64 };

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
  const sha256 = sha256Of(RECURRENT_MODEL_BYTES);
  return {
    identity: {
      pack: RECURRENT_PACK,
      version: RECURRENT_VERSION,
      modelHash: sha256Of(new TextEncoder().encode(`${sha256}  ${RECURRENT_MODEL_PATH}\n`)),
      runtimeHash,
    },
    files: [{ path: RECURRENT_MODEL_PATH, sha256 }],
    sampleRate,
    inference: { kind: InferenceMode.Pinned, graphOptimisation: GraphOptimisation.Extended },
  };
}

/** Runs the model over each channel in the schedule's runs, keeping each run's chunk. */
class RecurrentStream implements ModelStream {
  readonly #sessions: ModelSessions;
  readonly #emit: ModelOutput;
  /** Each channel's frames from `#base` on. */
  #held: Float32Array[];
  #base = 0;
  #frames = 0;
  #run = 0;

  constructor(sessions: ModelSessions, channels: number, emit: ModelOutput) {
    this.#sessions = sessions;
    this.#emit = emit;
    this.#held = Array.from({ length: channels }, () => new Float32Array(0));
  }

  async hear(input: readonly Float32Array[], frames: number, signal?: CancellationSignal) {
    this.#held = this.#held.map((held, channel) => {
      const grown = new Float32Array(held.length + frames);
      grown.set(held);
      grown.set(input[channel]?.subarray(0, frames) ?? [], held.length);
      return grown;
    });
    this.#frames += frames;
    for (;;) {
      const run = scheduledRun(RECURRENT_SCHEDULE, this.#run);
      if (this.#frames < run.first + run.length) return succeed(undefined);
      const ran = await this.#runNext(signal);
      if (!ran.ok) return ran;
    }
  }

  async end(signal?: CancellationSignal) {
    while (scheduledRun(RECURRENT_SCHEDULE, this.#run).kept < this.#frames) {
      const ran = await this.#runNext(signal);
      if (!ran.ok) return ran;
    }
    return succeed(undefined);
  }

  release(): void {
    this.#held = [];
  }

  async #runNext(signal: CancellationSignal | undefined): Promise<DomainResult<void>> {
    const run = scheduledRun(RECURRENT_SCHEDULE, this.#run);
    const keep = Math.min(RECURRENT_SCHEDULE.chunk, this.#frames - run.kept);
    const kept: Float32Array[] = [];
    for (const held of this.#held) {
      const x = new Float32Array(run.length);
      x.set(held.subarray(run.first - this.#base, run.first - this.#base + run.length));
      const input = tensor(x, [1, run.length]);
      if (!input.ok) return input;
      const ran = await this.#sessions
        .of(RECURRENT_MODEL_PATH)
        .run(new Map([['x', input.value]]), signal);
      if (!ran.ok) return ran;
      kept.push(
        ran.value.get('y')?.data.slice(run.offset, run.offset + keep) ?? new Float32Array(keep),
      );
    }
    this.#run += 1;
    const forget = scheduledRun(RECURRENT_SCHEDULE, this.#run).first - this.#base;
    this.#held = this.#held.map((held) => held.slice(Math.max(0, forget)));
    this.#base += Math.max(0, forget);
    await this.#emit(kept, keep);
    return succeed(undefined);
  }
}

/** The processor's descriptor for the model `definition` names. */
function descriptorOf(definition: ModelDefinition): ProcessorDescriptor {
  return {
    typeKey: 'test-recurrence',
    label: 'Test recurrence',
    category: ProcessorCategory.Restoration,
    version: {
      implementation: 1,
      parameters: 1,
      resampler: CANONICAL_RESAMPLER_VERSION,
      model: definition.identity,
    },
    parameters: [],
    qualitySettings: ['resampling'],
    determinism: DeterminismClass.Pinned,
    wholePass: true,
    realTime: false,
    outputLayout: (input) => succeed(input),
    latency: () => ({ kind: 'known', frames: ZERO_SAMPLES }),
    leadIn: () => 0,
    frameGrid: () => 1,
  };
}

/** The test processor over the model `definition` names. */
export function recurrentProcessor(definition: ModelDefinition): ModelProcessor {
  return {
    descriptor: descriptorOf(definition),
    model: definition,
    stream: (sessions, run, emit) => new RecurrentStream(sessions, run.input.roles.length, emit),
  };
}
