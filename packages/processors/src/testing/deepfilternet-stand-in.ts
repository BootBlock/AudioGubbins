/**
 * DeepFilterNet 3's three graphs played by models written in TypeScript, for
 * the tests that run the processor without its pack: here, around stand-ins
 * for its graphs' files, and in the packages whose threads run it, from the
 * stand-ins read as though installed or from a pack of them installed whole.
 *
 * The encoder gives outputs of the shapes it declares, all zero; the
 * decoders give every band the gain `gain` and every bin the deep filter
 * whose only tap, on the frame itself, is `tap`. So a gain and a tap of one
 * give the input back, and both of zero give silence, which the processor's
 * own attenuation limit bounds.
 */

import type { CancellationSignal } from '@audiogubbins/domain';
import type {
  InferenceOptions,
  InferencePort,
  ModelBytes,
  RuntimeIdentity,
} from '@audiogubbins/ml-runtime';
import { FakeInference, type FakeModel } from '@audiogubbins/ml-runtime/testing';

import { processorTypesWith } from '../catalogue.js';
import type { ProcessorType } from '../framework/processor-type.js';
import { DEEPFILTERNET_3 } from '../ml/deepfilternet/deepfilternet.js';
import { modelProcessorType } from '../ml/model-processor.js';
import {
  DEEPFILTERNET_3_MODEL,
  DeepFilterNetGraph,
} from '../ml/deepfilternet/deepfilternet-model.js';
import type { ModelDefinitionFile } from '../ml/model-definition.js';
import type { ModelServices } from '../ml/model-sessions.js';

function frames(dims: readonly number[]): number {
  return dims[2] ?? 0;
}

/** The encoder, giving outputs of the declared shapes, all zero. */
const ENCODER: FakeModel = {
  inputs: [
    { name: 'feat_erb', dims: [1, 1, 'S', 32] },
    { name: 'feat_spec', dims: [1, 2, 'S', 96] },
  ],
  outputs: [],
  run: (inputs) => {
    const length = frames(inputs.get('feat_erb')?.dims ?? []);
    const zeros = (dims: number[]) => ({
      data: new Float32Array(dims.reduce((product, one) => product * one, 1)),
      dims,
    });
    return new Map([
      ['e0', zeros([1, 64, length, 32])],
      ['e1', zeros([1, 64, length, 16])],
      ['e2', zeros([1, 64, length, 8])],
      ['e3', zeros([1, 64, length, 8])],
      ['emb', zeros([1, length, 512])],
      ['c0', zeros([1, 64, length, 96])],
      ['lsnr', zeros([1, length, 1])],
    ]);
  },
};

/** The models that stand in for each graph, by its file's path (see the module comment). */
export function deepFilterNetGraphs(gain: number, tap: number): ReadonlyMap<string, FakeModel> {
  const erb: FakeModel = {
    inputs: [
      { name: 'emb', dims: [1, 'S', 512] },
      { name: 'e3', dims: [1, 64, 'S', 8] },
      { name: 'e2', dims: [1, 64, 'S', 8] },
      { name: 'e1', dims: [1, 64, 'S', 16] },
      { name: 'e0', dims: [1, 64, 'S', 32] },
    ],
    outputs: [],
    run: (inputs) => {
      const length = frames(inputs.get('e0')?.dims ?? []);
      return new Map([
        ['m', { data: new Float32Array(length * 32).fill(gain), dims: [1, 1, length, 32] }],
      ]);
    },
  };
  const deep: FakeModel = {
    inputs: [
      { name: 'emb', dims: [1, 'S', 512] },
      { name: 'c0', dims: [1, 64, 'S', 96] },
    ],
    outputs: [],
    run: (inputs) => {
      const length = frames(inputs.get('c0')?.dims ?? []);
      const taps = new Float32Array(length * 96 * 10);
      // Tap 2 of 5 is the frame itself: two of the five lie behind it.
      for (let at = 0; at < length * 96; at += 1) taps[at * 10 + 4] = tap;
      return new Map([['coefs', { data: taps, dims: [1, length, 96, 10] }]]);
    },
  };
  return new Map([
    [DeepFilterNetGraph.Encoder, ENCODER],
    [DeepFilterNetGraph.ErbDecoder, erb],
    [DeepFilterNetGraph.DeepFilterDecoder, deep],
  ]);
}

/** A file of DeepFilterNet 3's pack as a stand-in: bytes the fake runtime runs, and a hash. */
export interface StandInFile {
  readonly path: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
  /** The SHA-256 the pack's integrity check would have taken of the real file. */
  readonly sha256: string;
}

const STAND_IN = 'stand-in for ';

/**
 * DeepFilterNet 3's pack as the build's definition names it, each file a
 * stand-in whose bytes name the graph it plays, read as though the installer
 * had checked it: with the SHA-256 of the real file. So the real definition,
 * its identity and its pinned runtime run on the fake runtime
 * ({@link StandInInference}).
 */
export function deepFilterNetPack(): readonly StandInFile[] {
  return DEEPFILTERNET_3_MODEL.files.map(({ path, sha256 }) => ({
    path,
    bytes: new TextEncoder().encode(`${STAND_IN}${path}`),
    sha256,
  }));
}

/**
 * How a thread that runs chains makes every processor type, those that run a
 * model made with its services, but for DeepFilterNet 3, which runs `files`:
 * the catalogue's descriptor and the identity an instance persists, held to
 * the hashes given. So a chain made from the catalogue runs from a pack of the
 * stand-ins of {@link deepFilterNetPack} that states their own hashes,
 * installed through the installer, which a test hashes as the installer does.
 */
export function typesRunningDeepFilterNetFiles(
  files: readonly ModelDefinitionFile[],
): (services: ModelServices) => ReadonlyMap<string, ProcessorType> {
  return (services) => {
    const standIn = modelProcessorType(
      { ...DEEPFILTERNET_3, model: { ...DEEPFILTERNET_3_MODEL, files } },
      services,
    );
    return new Map([...processorTypesWith(services), [standIn.descriptor.typeKey, standIn]]);
  };
}

/**
 * The inference port over the stand-in graphs: a file of
 * {@link deepFilterNetPack} runs as the graph it names, each on a fake runtime
 * of its own that says it is `runtime`, and the sessions open over them all
 * are counted.
 */
export class StandInInference implements InferencePort {
  readonly #runtimes: ReadonlyMap<string, FakeInference>;

  constructor(graphs: ReadonlyMap<string, FakeModel>, runtime: RuntimeIdentity) {
    this.#runtimes = new Map(
      [...graphs].map(([path, model]) => [path, new FakeInference(model, undefined, runtime)]),
    );
  }

  /** The sessions opened and not yet released, over every graph. */
  get openSessions(): number {
    return [...this.#runtimes.values()].reduce((sum, one) => sum + one.openSessions, 0);
  }

  /** The options of every session opened, over every graph. */
  get opened(): readonly InferenceOptions[] {
    return [...this.#runtimes.values()].flatMap((one) => one.opened);
  }

  open(model: ModelBytes, options: InferenceOptions, signal?: CancellationSignal) {
    const named = new TextDecoder().decode(model);
    const runtime = named.startsWith(STAND_IN)
      ? this.#runtimes.get(named.slice(STAND_IN.length))
      : undefined;
    if (runtime === undefined) throw new Error('The test gave no graph for these bytes.');
    return runtime.open(model, options, signal);
  }
}
