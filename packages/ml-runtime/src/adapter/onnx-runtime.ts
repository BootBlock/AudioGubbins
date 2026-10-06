/**
 * The inference port over ONNX Runtime Web (MIT), and the one module that
 * imports the runtime (ADR-0062); `onnx-session.ts` serves the sessions it
 * makes.
 *
 * The runtime is imported on the first session that needs it, by a dynamic
 * `import()`, so the base bundle carries none of it (REQ-AUDIO-139), and only
 * the worker that hosts this adapter ever loads it. Each build is started once
 * in its global scope, and before it is imported its WebAssembly file is read
 * through the port the adapter is given and its SHA-256 checked against the
 * digest the application's setup states: a file that differs is refused, and
 * the runtime is never imported. The runtime is given the bytes that matched
 * (`wasmBinary`) and no path, so it requests nothing of its own, and the
 * digest a session reports is that of the code that runs it. Each build's
 * script, the glue that instantiates its WebAssembly, is bundled into the
 * build's module, and a preview on more threads starts its workers from that
 * module, which the bundler emitted with the application. Threads, SIMD and
 * proxying are set before the first session, after which the runtime keeps
 * them.
 *
 * Pinned sessions run on the CPU build's WebAssembly backend alone, on one
 * thread, with fixed-width SIMD and in sequence; were that backend to fail,
 * the session is refused with the runtime's reason and no other backend is
 * tried.
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
  InferenceMode,
  RuntimeBuild,
  capabilityRefusal,
  runtimeConfigurationOf,
  type GraphOptimisation,
  type InferenceOptions,
  type RuntimeConfiguration,
  type RuntimeIdentity,
  type RuntimeSetup,
} from '../inference-options.js';
import {
  cancelled,
  unlessCancelled,
  type InferencePort,
  type InferenceSession,
  type ModelBytes,
} from '../inference-port.js';
import { RUNTIME_WEBASSEMBLY_FILES, type RuntimeFiles } from '../runtime-files.js';
import { sessionOver, type OnnxSession, type OnnxTensorConstructor } from './onnx-session.js';

/** The session options the adapter sets, named as the runtime names them. */
export interface OnnxSessionOptions {
  readonly executionProviders: readonly ('wasm' | 'webgpu')[];
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
  /** Imports each build of the runtime, called on the first session that needs it. */
  readonly load: Readonly<Record<RuntimeBuild, () => Promise<OnnxRuntimeModule>>>;
  /** Reads each build's WebAssembly file, which the adapter checks before the runtime has it. */
  readonly files: RuntimeFiles;
  /** Reports the runtime failing to free a session, which no caller can act on. */
  readonly reportFault: (error: unknown) => void;
}

/** The runtime's builds, each imported only when first asked for. */
export const ONNX_RUNTIME_BUILDS: OnnxRuntimeHost['load'] = {
  [RuntimeBuild.Cpu]: () => import('onnxruntime-web/wasm'),
  [RuntimeBuild.WebGpu]: () => import('onnxruntime-web/webgpu'),
};

/** The runtime's own report that it could start no backend it was asked for. */
const NO_BACKEND = /no available backend found/i;

/** A build started and named. */
interface Runtime {
  readonly module: OnnxRuntimeModule;
  readonly identity: RuntimeIdentity;
}

/** A build started in this scope: the threads it was started with, and the runtime. */
interface Started {
  readonly threads: number;
  readonly runtime: Promise<DomainResult<Runtime>>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unavailable(summary: string): DomainResult<never> {
  return fail(failure('inference.runtime-unavailable', FailureKind.Unrecoverable, summary));
}

/** `bytes`, read as `build`'s WebAssembly file, with their SHA-256, where it is `expected`. */
function verified(
  build: RuntimeBuild,
  bytes: Uint8Array<ArrayBuffer>,
  expected: string,
): DomainResult<{ readonly bytes: Uint8Array<ArrayBuffer>; readonly sha256: string }> {
  const file = RUNTIME_WEBASSEMBLY_FILES[build];
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
function sessionOptions(
  options: InferenceOptions,
  configuration: RuntimeConfiguration,
): OnnxSessionOptions {
  return {
    executionProviders: [configuration.build === RuntimeBuild.WebGpu ? 'webgpu' : 'wasm'],
    graphOptimizationLevel: options.graphOptimisation,
    intraOpNumThreads: configuration.threads,
    interOpNumThreads: 1,
    executionMode: 'sequential',
  };
}

/** Why the runtime would not create a session: it could not start, or it refused the model. */
function creationRefused(error: unknown, options: InferenceOptions): DomainResult<never> {
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
    options.kind === InferenceMode.Pinned
      ? `A pinned session runs on the runtime's WebAssembly backend alone, which could not start, so it is refused rather than run on another: ${reason}`
      : `The runtime could not start the backend the preview asked for: ${reason}`,
  );
}

/** The inference port over ONNX Runtime Web, started as the application's setup says. */
export class OnnxRuntimeInference implements InferencePort {
  readonly #setup: RuntimeSetup;
  readonly #host: OnnxRuntimeHost;
  readonly #started = new Map<RuntimeBuild, Started>();

  constructor(setup: RuntimeSetup, host: OnnxRuntimeHost) {
    this.#setup = setup;
    this.#host = host;
  }

  async open(
    model: ModelBytes,
    options: InferenceOptions,
    signal?: CancellationSignal,
  ): Promise<DomainResult<InferenceSession>> {
    if (signal?.aborted === true) return cancelled();
    const refusal = capabilityRefusal(options, this.#setup.capabilities);
    if (refusal !== undefined) return fail(refusal);
    const configuration = runtimeConfigurationOf(options);
    const runtime = await unlessCancelled(this.#start(configuration), signal);
    if (!runtime.ok) return runtime;
    const { module, identity } = runtime.value;
    const creating = module.InferenceSession.create(
      model,
      sessionOptions(options, configuration),
    ).then(
      (session) =>
        sessionOver(session, module.Tensor, { options, runtime: identity }, this.#host.reportFault),
      (error: unknown) => creationRefused(error, options),
    );
    return await unlessCancelled(creating, signal, {
      discard: (session) => {
        session.release();
      },
    });
  }

  /** The build `configuration` names, started once with its threads, or why it cannot be. */
  #start(configuration: RuntimeConfiguration): Started['runtime'] {
    const { build, threads } = configuration;
    const started = this.#started.get(build);
    if (started !== undefined) {
      return started.threads === threads
        ? started.runtime
        : Promise.resolve(
            fail(
              failure(
                'inference.runtime-configured',
                FailureKind.Conflict,
                `The runtime's ${build} build was started here on ${String(started.threads)} threads and keeps them, so a session on ${String(threads)} runs in another worker.`,
              ),
            ),
          );
    }
    const runtime = this.#launched(configuration);
    this.#started.set(build, { threads, runtime });
    return runtime;
  }

  /**
   * The build `configuration` names, imported and configured once its
   * WebAssembly file has been read and has matched the setup's digest.
   */
  async #launched(configuration: RuntimeConfiguration): Started['runtime'] {
    const { build } = configuration;
    const read = await this.#host.files.read(build);
    if (!read.ok) {
      // Nothing was started, and the server may answer the next time, so the
      // next session reads the file again rather than meeting this failure
      // for the worker's life. The entry is this call's own: it was set as
      // the call began, and nothing replaces an entry while it stands.
      this.#started.delete(build);
      return read;
    }
    const file = verified(build, read.value, this.#setup.webAssemblySha256[build]);
    if (!file.ok) return file;
    return await this.#host.load[build]().then(
      (module) => this.#configured(module, configuration, file.value),
      (error: unknown) =>
        unavailable(`The runtime's ${build} build could not be loaded: ${messageOf(error)}`),
    );
  }

  /** Sets what the runtime reads as it starts, before its first session, and names it. */
  #configured(
    module: OnnxRuntimeModule,
    { threads }: RuntimeConfiguration,
    file: { readonly bytes: Uint8Array<ArrayBuffer>; readonly sha256: string },
  ): DomainResult<Runtime> {
    const version = module.env.versions.web;
    if (version === undefined) {
      return unavailable('The runtime does not say its version, which a pinned render records.');
    }
    module.env.wasm.numThreads = threads;
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
