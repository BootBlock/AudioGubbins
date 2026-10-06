/**
 * What a machine-learning processor runs, as this build states it: the model
 * by its pack and the hashes of the files it runs, the runtime build by the
 * hash of its WebAssembly, and how each session is pinned (ADR-0062).
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
  succeed,
  type DomainResult,
  type ModelIdentity,
  type SampleRate,
} from '@audiogubbins/domain';
import type { InferenceExecution, InferenceMode, InferenceOptions } from '@audiogubbins/ml-runtime';

import type { ModelFile } from './model-library.js';

/**
 * The SHA-256 of `ort-wasm-simd-threaded.wasm` of onnxruntime-web 1.30.0,
 * the CPU build every pinned session runs on: the runtime half of every
 * model identity this build states. A test holds it to the installed file.
 */
export const PINNED_RUNTIME_SHA256 =
  '3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2';

/**
 * The version of the canonical resampler a processor that converts its
 * input to a model's rate and back states (REQ-AUDIO-145). The engine names
 * no version of its own for the resampler yet, so this is the first, and it
 * rises whenever `crates/resampling` changes the bits it writes.
 */
export const CANONICAL_RESAMPLER_VERSION = 1;

/** A file a model runs, by its path within its pack and its SHA-256. */
export interface ModelDefinitionFile {
  readonly path: string;
  readonly sha256: string;
}

/** A model as this build runs it. */
export interface ModelDefinition {
  /**
   * The identity an instance persists: `modelHash` is the hash of the
   * listing of {@link files} (`processor-version.ts`), and a test holds the
   * two to agreeing.
   */
  readonly identity: ModelIdentity;
  /** The files the processor runs, each the pack's file of that path. */
  readonly files: readonly ModelDefinitionFile[];
  /** The rate the model hears and speaks at. */
  readonly sampleRate: SampleRate;
  /**
   * How every session is opened: pinned, at a graph optimisation level that
   * is part of the implementation, since it may change the arithmetic.
   */
  readonly inference: Extract<InferenceOptions, { readonly kind: typeof InferenceMode.Pinned }>;
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

/** Why a session that ran on `execution` is not the runtime `definition` names, or nothing. */
export function runtimeRefusal(
  definition: ModelDefinition,
  execution: InferenceExecution,
): DomainResult<void> {
  const found = execution.runtime.webAssemblySha256;
  const expected = definition.identity.runtimeHash;
  if (found === expected) return succeed(undefined);
  return fail(
    failure(
      'model.runtime-mismatch',
      FailureKind.Unrecoverable,
      `The inference runtime is not the build ${definition.identity.pack} is pinned to, so its render would not be the one the instance names: its WebAssembly's SHA-256 is ${found}, and the build names ${expected}.`,
      {
        details: {
          runtime: `${execution.runtime.name} ${execution.runtime.version}`,
          foundSha256: found,
          expectedSha256: expected,
        },
      },
    ),
  );
}
