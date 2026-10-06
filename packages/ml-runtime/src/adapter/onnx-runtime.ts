/**
 * The inference port over ONNX Runtime Web (MIT), and the one module that
 * imports the runtime (ADR-0062); `onnx-session.ts` serves the sessions it
 * makes.
 *
 * The runtime is imported on the first session that needs it, by a dynamic
 * `import()`, so the base bundle carries none of it (REQ-AUDIO-139), and only
 * the worker that hosts this adapter ever loads it. Each build is started once
 * in its global scope: its WebAssembly file is named under the base URL the
 * application gives, and its threads, SIMD and proxying are set before its
 * first session, after which the runtime keeps them. This module calls no
 * network API of its own. The runtime's loader requests its WebAssembly file
 * from the URL set here, under the application's own origin; that is the one
 * request inference makes, and it carries nothing of the person's.
 *
 * Pinned sessions run on the CPU build's WebAssembly backend alone, on one
 * thread, with fixed-width SIMD and in sequence; were that backend to fail,
 * the session is refused with the runtime's reason and no other backend is
 * tried.
 */

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
      /** Written as `{ wasm }`, and never read here, so its type is the runtime's concern. */
      wasmPaths?: unknown;
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
  /** Reports the runtime failing to free a session, which no caller can act on. */
  readonly reportFault: (error: unknown) => void;
}

/** The runtime's builds, each imported only when first asked for. */
export const ONNX_RUNTIME_BUILDS: OnnxRuntimeHost['load'] = {
  [RuntimeBuild.Cpu]: () => import('onnxruntime-web/wasm'),
  [RuntimeBuild.WebGpu]: () => import('onnxruntime-web/webgpu'),
};

/** Each build's WebAssembly file, which the application serves under its base URL. */
const WEBASSEMBLY_FILES: Readonly<Record<RuntimeBuild, string>> = {
  [RuntimeBuild.Cpu]: 'ort-wasm-simd-threaded.wasm',
  [RuntimeBuild.WebGpu]: 'ort-wasm-simd-threaded.asyncify.wasm',
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
    const runtime = this.#host.load[build]().then(
      (module) => this.#configured(module, configuration),
      (error: unknown) =>
        unavailable(`The runtime's ${build} build could not be loaded: ${messageOf(error)}`),
    );
    this.#started.set(build, { threads, runtime });
    return runtime;
  }

  /** Sets what the runtime reads as it starts, before its first session, and names it. */
  #configured(
    module: OnnxRuntimeModule,
    { build, threads }: RuntimeConfiguration,
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
    // The file alone, not a base: given a base, the runtime would also import
    // its script from there rather than run the one bundled with it.
    module.env.wasm.wasmPaths = { wasm: `${this.#setup.filesBase}${WEBASSEMBLY_FILES[build]}` };
    return succeed({
      module,
      identity: {
        name: 'onnxruntime-web',
        version,
        webAssemblySha256: this.#setup.webAssemblySha256[build],
      },
    });
  }
}
