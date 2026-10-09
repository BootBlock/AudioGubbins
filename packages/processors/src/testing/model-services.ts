/**
 * The services a machine-learning processor runs its model through, played
 * by a test: a model library over files in memory, and an inference port
 * that runs each file as the model written in TypeScript that the test gives
 * for it, by the fake runtime of `@audiogubbins/ml-runtime/testing`, which
 * keeps the port's contract as the real adapter does.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { fail, failure, FailureKind, succeed, type CancellationSignal } from '@audiogubbins/domain';
import type {
  InferenceOptions,
  InferencePort,
  ModelBytes,
  ModelSource,
} from '@audiogubbins/ml-runtime';
import { FAKE_RUNTIME, FakeInference, type FakeModel } from '@audiogubbins/ml-runtime/testing';

import type { ModelDefinition } from '../ml/model-definition.js';
import { ModelUnavailability, modelUnavailable, type ModelLibrary } from '../ml/model-library.js';

/** The SHA-256 of `bytes`, in lower-case hexadecimal. */
export function sha256Of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * The CPU build's WebAssembly of the inference runtime installed for
 * ml-runtime, the package that depends on it, as a pinned session runs it.
 */
export function runtimeWebAssembly(): Uint8Array<ArrayBuffer> {
  const entry = createRequire(import.meta.url).resolve('@audiogubbins/ml-runtime');
  const runtime = createRequire(entry).resolve('onnxruntime-web');
  return new Uint8Array(readFileSync(join(dirname(runtime), 'ort-wasm-simd-threaded.wasm')));
}

/** A file a memory library holds. */
export interface MemoryModelFile {
  readonly pack: string;
  readonly version: string;
  readonly path: string;
  readonly bytes: ModelBytes;
}

/**
 * A model library over files in memory, each given with the SHA-256 of its
 * bytes as a pack's integrity check would take it; a file it does not hold is
 * a required model unavailable. It counts the files it was asked for.
 */
export class MemoryModelLibrary implements ModelLibrary {
  readonly #files: ReadonlyMap<string, ModelBytes>;
  /** Every file asked for, as `pack/version/path`. */
  readonly asked: string[] = [];

  constructor(files: readonly MemoryModelFile[]) {
    this.#files = new Map(
      files.map((file) => [`${file.pack}/${file.version}/${file.path}`, file.bytes]),
    );
  }

  file(pack: string, version: string, path: string, signal?: CancellationSignal) {
    const key = `${pack}/${version}/${path}`;
    this.asked.push(key);
    if (signal?.aborted === true) {
      return Promise.resolve(
        fail(failure('model.cancelled', FailureKind.Rejected, 'The read was cancelled.')),
      );
    }
    const bytes = this.#files.get(key);
    if (bytes === undefined) {
      return Promise.resolve(
        modelUnavailable(
          ModelUnavailability.RequiredUnavailable,
          `No installed pack holds ${path} of ${pack} ${version}.`,
          { pack, version, path },
        ),
      );
    }
    return Promise.resolve(succeed({ bytes: bytes.slice(), sha256: sha256Of(bytes) }));
  }
}

/**
 * An inference port that runs each model file as the model written in
 * TypeScript that `models` names for the SHA-256 it is opened by, each by a
 * fake runtime of its own, and counts the sessions open over them all.
 */
export class FakeModels implements InferencePort {
  readonly #runtimes: ReadonlyMap<string, FakeInference>;

  constructor(models: ReadonlyMap<string, FakeModel>) {
    this.#runtimes = new Map(
      [...models].map(([sha256, model]) => [sha256, new FakeInference(model)]),
    );
  }

  /** The sessions opened and not yet released, over every model. */
  get openSessions(): number {
    return [...this.#runtimes.values()].reduce((sum, runtime) => sum + runtime.openSessions, 0);
  }

  /** The options of every session opened, over every model. */
  get opened(): readonly InferenceOptions[] {
    return [...this.#runtimes.values()].flatMap((runtime) => runtime.opened);
  }

  open(model: ModelSource, options: InferenceOptions, signal?: CancellationSignal) {
    const runtime = this.#runtimes.get(model.sha256);
    if (runtime === undefined) throw new Error('The test gave no model for this file.');
    return runtime.open(model, options, signal);
  }
}

/**
 * The bytes of the stand-in for a model's file at `path`: a file the fake
 * runtime never reads, named by its hash, which differs from path to path.
 */
function standInBytes(path: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`stand-in ${path}`);
}

/** `definition` over a stand-in for each of its files, on the fake runtime. */
export function standInModel(definition: ModelDefinition): ModelDefinition {
  return {
    ...definition,
    identity: { ...definition.identity, runtimeHash: FAKE_RUNTIME.webAssemblySha256 },
    files: definition.files.map(({ path }) => ({ path, sha256: sha256Of(standInBytes(path)) })),
  };
}

/** The services a stand-in's sessions run on: its files, and the models they run as. */
export interface StandInServices {
  readonly inference: FakeModels;
  readonly models: MemoryModelLibrary;
}

/**
 * The services that serve `definition`'s stand-in files ({@link standInModel})
 * and run each as the model written in TypeScript that `graphs` names for its
 * path.
 */
export function standInServices(
  definition: ModelDefinition,
  graphs: ReadonlyMap<string, FakeModel>,
): StandInServices {
  const { pack, version } = definition.identity;
  return {
    inference: new FakeModels(
      new Map([...graphs].map(([path, model]) => [sha256Of(standInBytes(path)), model])),
    ),
    models: new MemoryModelLibrary(
      definition.files.map(({ path }) => ({ pack, version, path, bytes: standInBytes(path) })),
    ),
  };
}
