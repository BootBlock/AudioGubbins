/**
 * Local inference as the browser runs it (ADR-0062): the page's end of the
 * inference worker, one for the whole application, the model library on the
 * installed packs, and what each model's availability is, made once by the
 * composition root.
 *
 * Every thread that runs chains (the preview, render, feeder, peak and
 * detection workers) is started here (`startChainWorker`), connected to them as
 * it starts, through a model channel of its own, and let go of them as it is
 * terminated, so the inference workers drop the sessions a terminated thread
 * held. The runtime's identity, and the inference host with it, are loaded when
 * first needed, and the inference worker is started only when a thread first
 * opens a session, so a page that runs no model loads none of the runtime. The
 * worker reads the runtime's WebAssembly from the application's own origin,
 * under the path the build serves it at, and checks it against the digest the
 * build took of the bytes it serves.
 */

import {
  LOCAL_INFERENCE,
  localInferenceCapabilities,
  type CapabilityRegistry,
} from '@audiogubbins/capabilities';
import type { Logger } from '@audiogubbins/diagnostics';
import {
  InferenceHost,
  ModelThreads,
  type InferenceCapabilities,
  type InferenceThreadPort,
  type RuntimeIdentity,
  type RuntimeSetup,
} from '@audiogubbins/ml-runtime';
import inferenceWorkerUrl from '@audiogubbins/ml-runtime/threads/inference-worker.ts?worker&url';
import type { StorageClient } from '@audiogubbins/storage-runtime';

import { moduleWorkerClass } from '../module-worker.js';
import { installedModelFiles, installedModelVersions } from './installed-model-files.js';
import { createModelAvailabilityStore, type ModelAvailabilityStore } from './model-availability.js';

/** The runtime this build ships, as the composition root loads it. */
interface InferenceRuntimeFacts {
  readonly RUNTIME_IN_USE: RuntimeIdentity;
  readonly runtimeFiles: (origin: string) => Omit<RuntimeSetup, 'capabilities'>;
}

/** The facts the build made, loaded on first use. */
function builtRuntime(): Promise<InferenceRuntimeFacts> {
  return import('./inference-runtime-facts.js');
}

/** Local inference on this page (see the module comment). */
export interface ModelServices {
  readonly availability: ModelAvailabilityStore;
  /**
   * Starts the module worker at `url`, a thread that runs chains, connected to
   * the inference workers and the installed packs until it is terminated.
   */
  readonly startChainWorker: (url: string) => Worker;
  readonly dispose: () => void;
}

/** An inference worker, its errors handled here rather than reported again by the page. */
function inferenceWorker(): InferenceThreadPort {
  const worker = new (moduleWorkerClass())(inferenceWorkerUrl, 'AudioGubbins inference');
  return {
    postMessage: (message, transfer) => {
      // What the host gives up is the end of a thread's channel, and nothing else.
      worker.postMessage(
        message,
        transfer.filter((one): one is MessagePort => one instanceof MessagePort),
      );
    },
    addEventListener: (_type, listener) => {
      worker.addEventListener('error', (event) => {
        event.preventDefault();
        listener({ message: event.message });
      });
    },
    terminate: () => {
      worker.terminate();
    },
  };
}

/** Availability as the installer keeps it, the runtime this build ships and the device. */
function availabilityOn(
  capabilities: CapabilityRegistry,
  storage: StorageClient | undefined,
  logger: Logger,
): ModelAvailabilityStore {
  return createModelAvailabilityStore({
    packs: storage?.packs,
    runtime: async () => (await builtRuntime()).RUNTIME_IN_USE,
    device: () => capabilities.featureAvailability(LOCAL_INFERENCE),
    unknown: (reason) => {
      logger.warning('Which model packs can run could not be read.', { reason });
    },
  });
}

/** The inference host, made once on first use with the runtime's files on this page's origin. */
function inferenceHostOnce(capabilities: InferenceCapabilities): {
  readonly host: () => Promise<InferenceHost>;
  readonly dispose: () => void;
} {
  let made: Promise<InferenceHost> | undefined;
  return {
    host: () =>
      (made ??= builtRuntime().then(
        (facts) =>
          new InferenceHost({
            createWorker: inferenceWorker,
            setup: { ...facts.runtimeFiles(location.origin), capabilities },
          }),
      )),
    dispose: () => {
      void made?.then((host) => {
        host.dispose();
      });
    },
  };
}

/**
 * Starts the workers that run chains, each connected to its model channel by
 * `threads` from its start. The hosts that hold these threads end one only by
 * terminating it, and a terminated thread closes no channel, so the worker
 * itself lets go of what it held as it is terminated: a worker of its own kind,
 * rather than a hook every host would have to remember beside `terminate`. Each
 * is a module worker: the development server serves one as a module with
 * imports, and the build's single file runs as one as well. The class is made
 * when the first is started, not as the module or the services load, since
 * `Worker` is a global of the browser's page alone.
 */
function chainWorkers(threads: ModelThreads): (url: string) => Worker {
  let made: (new (url: string) => Worker) | undefined;
  return (url) => new (made ??= chainWorkerClass(threads))(url);
}

/** The kind of worker `chainWorkers` starts, connected by `threads`. */
function chainWorkerClass(threads: ModelThreads): new (url: string) => Worker {
  return class ChainWorker extends moduleWorkerClass() {
    readonly #disconnect: () => void;

    constructor(url: string) {
      super(url);
      this.#disconnect = threads.connect(this);
    }

    override terminate(): void {
      super.terminate();
      this.#disconnect();
    }
  };
}

/**
 * Local inference over the storage worker's packs and the capabilities
 * registry: its workers are started only when a chain first runs a model, and
 * every thread that runs chains is connected to them.
 */
export function startModels(
  capabilities: CapabilityRegistry,
  storage: StorageClient | undefined,
  logger: Logger,
): ModelServices {
  const inferenceCapabilities = localInferenceCapabilities(capabilities);
  const availability = availabilityOn(capabilities, storage, logger);
  const inference = inferenceHostOnce(inferenceCapabilities);
  const installed = { files: storage?.packs, context: availability.current };
  const threads = new ModelThreads({
    inference: inference.host,
    capabilities: inferenceCapabilities,
    versions: installedModelVersions(installed),
    files: installedModelFiles(installed),
    createChannel: () => new MessageChannel(),
    reportFault: (summary) => {
      logger.error('A thread that runs models sent what cannot be read.', { reason: summary });
    },
  });
  return {
    availability,
    startChainWorker: chainWorkers(threads),
    dispose: () => {
      availability.dispose();
      inference.dispose();
    },
  };
}
