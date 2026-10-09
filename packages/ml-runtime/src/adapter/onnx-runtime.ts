/**
 * The inference port over ONNX Runtime Web (MIT), and the one module that
 * imports the runtime (ADR-0062); `onnx-session.ts` serves the sessions it
 * makes.
 *
 * The runtime is imported on the first session that needs it, by a dynamic
 * `import()`, so the base bundle carries none of it (REQ-AUDIO-139), and only
 * the worker that hosts this adapter ever loads it. Its CPU build is started
 * once in its global scope, and before it is imported its WebAssembly file is
 * read through the port the adapter is given and its SHA-256 checked against
 * the digest the application's setup states: a file that differs is refused,
 * and the runtime is never imported. The runtime is given the bytes that
 * matched (`wasmBinary`) and no path, so it requests nothing of its own, and
 * the digest a session reports is that of the code that runs it. The build's
 * script, the glue that instantiates its WebAssembly, is bundled into the
 * build's module. Threads, SIMD and proxying are set before the first
 * session, after which the runtime keeps them.
 *
 * Sessions run on the WebAssembly backend alone, on one thread, with
 * fixed-width SIMD and in sequence; were that backend to fail, the session is
 * refused with the runtime's reason and no other backend is tried.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type CancellationSignal,
  type DomainResult,
} from '@audiogubbins/domain';

import {
  capabilityRefusal,
  type GraphOptimisation,
  type InferenceOptions,
  type RuntimeIdentity,
  type RuntimeSetup,
} from '../inference-options.js';
import {
  cancelled,
  unlessCancelled,
  type InferencePort,
  type InferenceSession,
  type ModelSource,
} from '../inference-port.js';
import { RUNTIME_WEBASSEMBLY_FILE, type RuntimeFiles } from '../runtime-files.js';
import { sessionOver, type OnnxSession, type OnnxTensorConstructor } from './onnx-session.js';

/** The session options the adapter sets, named as the runtime names them. */
export interface OnnxSessionOptions {
  readonly executionProviders: readonly 'wasm'[];
  readonly graphOptimizationLevel: GraphOptimisation;
  readonly intraOpNumThreads: number;
  readonly interOpNumThreads: number;
  readonly executionMode: 'sequential';
}

/** The part of the runtime's module the adapter uses. */
export interface OnnxRuntimeModule {
  readonly env: {
    readonly versions: { readonly web?: string };
    readonly wasm: {
      numThreads?: number;
      simd?: boolean | 'fixed' | 'relaxed';
      proxy?: boolean;
      /**
       * The WebAssembly the runtime instantiates, so it fetches none: written
       * and never read here, so its type is the runtime's own.
       */
      wasmBinary?: ArrayBufferLike | Uint8Array;
    };
  };
  readonly InferenceSession: {
    create(model: Uint8Array, options: OnnxSessionOptions): Promise<OnnxSession>;
  };
  readonly Tensor: OnnxTensorConstructor;
}

/** What the adapter is given beside the application's setup. */
export interface OnnxRuntimeHost {
  /** Imports the runtime, called on the first session. */
  readonly load: () => Promise<OnnxRuntimeModule>;
  /** Reads the runtime's WebAssembly file, which the adapter checks before the runtime has it. */
  readonly files: RuntimeFiles;
  /** Reports the runtime failing to free a session, which no caller can act on. */
  readonly reportFault: (error: unknown) => void;
}

/** The runtime's CPU build, imported only when first asked for. */
export const loadOnnxRuntime: OnnxRuntimeHost['load'] = () => import('onnxruntime-web/wasm');

/** The runtime's own report that it could start no backend it was asked for. */
const NO_BACKEND = /no available backend found/i;

/** A build started and named. */
interface Runtime {
  readonly module: OnnxRuntimeModule;
  readonly identity: RuntimeIdentity;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unavailable(summary: string): DomainResult<never> {
  return fail(failure('inference.runtime-unavailable', FailureKind.Unrecoverable, summary));
}

/** `bytes`, read as the runtime's WebAssembly file, with their SHA-256, where it is `expected`. */
function verified(
  bytes: Uint8Array<ArrayBuffer>,
  expected: string,
): DomainResult<{ readonly bytes: Uint8Array<ArrayBuffer>; readonly sha256: string }> {
  const file = RUNTIME_WEBASSEMBLY_FILE;
  const found = bytesToHex(sha256(bytes));
  if (found === expected) return succeed({ bytes, sha256: found });
  return fail(
    failure(
      'inference.runtime-file-mismatch',
      FailureKind.IntegrityViolation,
      `The runtime's WebAssembly file ${file} is not the one this build names, so the runtime is not started: its SHA-256 is ${found}, and the build names ${expected}.`,
      { details: { file, expectedSha256: expected, foundSha256: found } },
    ),
  );
}

/** The options a session of `options` is created with. */
function sessionOptions(options: InferenceOptions): OnnxSessionOptions {
  return {
    executionProviders: ['wasm'],
    graphOptimizationLevel: options.graphOptimisation,
    intraOpNumThreads: 1,
    interOpNumThreads: 1,
    executionMode: 'sequential',
  };
}

/** Why the runtime would not create a session: it could not start, or it refused the model. */
function creationRefused(error: unknown): DomainResult<never> {
  const reason = messageOf(error);
  if (!NO_BACKEND.test(reason)) {
    return fail(
      failure(
        'inference.model-refused',
        FailureKind.Unrecoverable,
        `The runtime refused the model: ${reason}`,
      ),
    );
  }
  return unavailable(
    `A session runs on the runtime's WebAssembly backend alone, which could not start, so it is refused rather than run on another: ${reason}`,
  );
}

/** The inference port over ONNX Runtime Web, started as the application's setup says. */
export class OnnxRuntimeInference implements InferencePort {
  readonly #setup: RuntimeSetup;
  readonly #host: OnnxRuntimeHost;
  /** The runtime, once a session has asked for it, until it is found not to start. */
  #started: Promise<DomainResult<Runtime>> | undefined;

  constructor(setup: RuntimeSetup, host: OnnxRuntimeHost) {
    this.#setup = setup;
    this.#host = host;
  }

  async open(
    model: ModelSource,
    options: InferenceOptions,
    signal?: CancellationSignal,
  ): Promise<DomainResult<InferenceSession>> {
    if (signal?.aborted === true) return cancelled();
    const refusal = capabilityRefusal(this.#setup.capabilities);
    if (refusal !== undefined) return fail(refusal);
    // Read first, so a model that cannot be had starts no runtime.
    const bytes = await model.read(signal);
    if (!bytes.ok) return bytes;
    this.#started ??= this.#launched();
    const runtime = await unlessCancelled(this.#started, signal);
    if (!runtime.ok) return runtime;
    const { module, identity } = runtime.value;
    const creating = module.InferenceSession.create(bytes.value, sessionOptions(options)).then(
      (session) =>
        sessionOver(session, module.Tensor, { options, runtime: identity }, this.#host.reportFault),
      (error: unknown) => creationRefused(error),
    );
    return await unlessCancelled(creating, signal, {
      discard: (session) => {
        session.release();
      },
    });
  }

  /**
   * The runtime, imported and configured once its WebAssembly file has been
   * read and has matched the setup's digest.
   */
  async #launched(): Promise<DomainResult<Runtime>> {
    const read = await this.#host.files.read();
    if (!read.ok) {
      // Nothing was started, and the server may answer the next time, so the
      // next session reads the file again rather than meeting this failure
      // for the worker's life.
      this.#started = undefined;
      return read;
    }
    const file = verified(read.value, this.#setup.webAssemblySha256);
    if (!file.ok) return file;
    return await this.#host.load().then(
      (module) => this.#configured(module, file.value),
      (error: unknown) => unavailable(`The runtime could not be loaded: ${messageOf(error)}`),
    );
  }

  /** Sets what the runtime reads as it starts, before its first session, and names it. */
  #configured(
    module: OnnxRuntimeModule,
    file: { readonly bytes: Uint8Array<ArrayBuffer>; readonly sha256: string },
  ): DomainResult<Runtime> {
    const version = module.env.versions.web;
    if (version === undefined) {
      return unavailable('The runtime does not say its version, which a pinned render records.');
    }
    // One thread: thread scheduling is not the same on every machine.
    module.env.wasm.numThreads = 1;
    // Fixed-width only: relaxed SIMD may round differently on different machines.
    module.env.wasm.simd = 'fixed';
    // This adapter already runs in a worker of its own; a proxy would start another.
    module.env.wasm.proxy = false;
    // The bytes, and no path: given a path, the runtime would fetch its file
    // itself, and given a base it would import its script from there too
    // rather than run the one bundled with it.
    module.env.wasm.wasmBinary = file.bytes;
    return succeed({
      module,
      identity: { name: 'onnxruntime-web', version, webAssemblySha256: file.sha256 },
    });
  }
}
