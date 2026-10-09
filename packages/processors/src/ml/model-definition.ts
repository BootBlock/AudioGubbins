/**
 * What a machine-learning processor runs, as this build states it: the model
 * by its pack's version and the hashes of the files it runs, the runtime
 * build by the hash of its WebAssembly, and how each session is pinned
 * (ADR-0062).
 *
 * The identity is the one an instance persists (REQ-AUDIO-145) and its
 * version check compares, so a project made with another model or runtime is
 * refused with the reason; the pass holds the files it is handed and the
 * session it is given to the same identity before it runs anything, so what
 * an instance says made its sound is what did.
 */

import {
  FailureKind,
  fail,
  failure,
  sampleRate,
  succeed,
  type DomainResult,
  type ModelIdentity,
  type SampleRate,
} from '@audiogubbins/domain';
import type { InferenceExecution, InferenceOptions } from '@audiogubbins/ml-runtime';

import { ModelUnavailability, modelUnavailable, type ModelFile } from './model-library.js';

/**
 * The SHA-256 of `ort-wasm-simd-threaded.wasm` of onnxruntime-web 1.30.0,
 * the CPU build every pinned session runs on: the runtime half of every
 * model identity this build states. A test holds it to the installed file.
 */
export const PINNED_RUNTIME_SHA256 =
  '3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2';

/**
 * The rate of `hertz`, the one a model was trained at: a constant of the
 * processor that names it, so a refusal is a fault there, never something a
 * stream brings about.
 */
export function modelRate(hertz: number): SampleRate {
  const rate = sampleRate(hertz);
  if (!rate.ok) throw new Error(`${String(hertz)} Hz is not a sample rate.`);
  return rate.value;
}

/** A file a model runs, by its path within its pack and its SHA-256. */
export interface ModelDefinitionFile {
  readonly path: string;
  readonly sha256: string;
}

/** A model as this build runs it. */
export interface ModelDefinition {
  /**
   * The identity an instance persists: `modelHash` is `modelHashOf` the
   * listing of every file of the pack's version, its licences and notice
   * too, so it names the version as model packs do; a test holds it to the
   * pack's definition.
   */
  readonly identity: ModelIdentity;
  /**
   * The files the processor runs, each the pack's file of that path, which
   * the pass holds each file it reads to by its own hash.
   */
  readonly files: readonly ModelDefinitionFile[];
  /** The rate the model hears and speaks at. */
  readonly sampleRate: SampleRate;
  /**
   * How every session is opened: at a graph optimisation level that is part
   * of the implementation, since it may change the arithmetic.
   */
  readonly inference: InferenceOptions;
}

/** Why `file`, read as `path`, is not the file `definition` runs, or nothing where it is. */
export function fileRefusal(
  definition: ModelDefinition,
  path: string,
  file: ModelFile,
): DomainResult<void> {
  const expected = definition.files.find((one) => one.path === path)?.sha256;
  if (file.sha256 === expected) return succeed(undefined);
  const { pack, version } = definition.identity;
  return fail(
    failure(
      'model.file-mismatch',
      FailureKind.IntegrityViolation,
      `The file ${path} of ${pack} ${version} is not the one this build runs, so the model is not run: its SHA-256 is ${file.sha256}, and the build names ${String(expected)}.`,
      {
        details: {
          pack,
          version,
          path,
          foundSha256: file.sha256,
          expectedSha256: String(expected),
        },
      },
    ),
  );
}

/**
 * Why a session that ran on `execution` is not the runtime `definition` names,
 * or nothing: the model is incompatible with the runtime in use, one of
 * REQ-AUDIO-139's conditions, so the processor is unavailable for that reason,
 * with the runtime's mismatch as its cause.
 */
export function runtimeRefusal(
  definition: ModelDefinition,
  execution: InferenceExecution,
): DomainResult<void> {
  const found = execution.runtime.webAssemblySha256;
  const expected = definition.identity.runtimeHash;
  if (found === expected) return succeed(undefined);
  const { pack, version } = definition.identity;
  const runtime = `${execution.runtime.name} ${execution.runtime.version}`;
  return modelUnavailable(
    ModelUnavailability.Incompatible,
    `${pack} ${version} is pinned to another build of the inference runtime than ${runtime}, so its render would not be the one the instance names.`,
    { pack, version },
    failure(
      'model.runtime-mismatch',
      FailureKind.Unrecoverable,
      `The inference runtime is not the build ${pack} is pinned to: its WebAssembly's SHA-256 is ${found}, and the build names ${expected}.`,
      { details: { runtime, foundSha256: found, expectedSha256: expected } },
    ),
  );
}
