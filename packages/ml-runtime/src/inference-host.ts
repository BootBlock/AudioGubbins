/**
 * The page's end of the inference workers (ADR-0062): one worker for each
 * runtime configuration, for the whole application, started when a thread
 * first connects to it and started with the runtime's setup.
 *
 * A worker hosts one runtime, and a session cannot leave the scope it was
 * opened in, so every thread that runs models (the preview, render, feeder,
 * peak and detection workers) talks to the one worker over a channel of its
 * own, which the thread makes and the host hands on. So the runtime is
 * started, and its WebAssembly read and checked, once for the application
 * rather than once a thread, a model's sessions live in one place, and a
 * tensor crosses once each way. The page holds no session and runs nothing.
 *
 * Each thread is a client, known by a number: once the thread has gone the
 * host tells every worker to let its sessions go, since a terminated thread
 * closes no channel. A worker that fails is ended and forgotten, and each
 * client connected to it is told why, so its waiting calls fail with the
 * reason rather than wait; the next connection starts a new one.
 */

import type { ChannelEnd } from './channel-end.js';
import type { RuntimeConfiguration, RuntimeSetup } from './inference-options.js';
import { ToInferenceThreadKind, type ToInferenceThread } from './protocol/inference-messages.js';
import { configurationKey } from './worker-inference.js';

/** The part of a `Worker` the host uses, so a test can play the worker. */
export interface InferenceThreadPort {
  postMessage(message: ToInferenceThread, transfer: readonly object[]): void;
  addEventListener(type: 'error', listener: (event: { readonly message: string }) => void): void;
  terminate(): void;
}

/** A thread's place among the host's clients. */
export interface InferenceClient {
  /** Hands `end` to the worker that runs `configuration`, starting it if none runs. */
  connect(configuration: RuntimeConfiguration, end: ChannelEnd): void;
  /** Lets every session the thread held go, once it has gone. */
  disconnect(): void;
}

/** What the host is made with. */
export interface InferenceHostOptions {
  /** Starts an inference worker, the module `threads/inference-worker.ts`. */
  readonly createWorker: () => InferenceThreadPort;
  readonly setup: RuntimeSetup;
}

/** A worker started for a configuration. */
interface Running {
  readonly worker: InferenceThreadPort;
  readonly configuration: RuntimeConfiguration;
}

/** How a client hears that a worker it is connected to failed, and why. */
export type InferenceFailed = (configuration: RuntimeConfiguration, reason: string) => void;

/** A client, and how it hears that a worker it is connected to failed. */
interface Client {
  readonly failed: InferenceFailed;
  readonly connected: Set<string>;
}

/** The page's end of the inference workers (see the module comment). */
export class InferenceHost {
  readonly #options: InferenceHostOptions;
  readonly #running = new Map<string, Running>();
  readonly #clients = new Map<number, Client>();
  #clientsMade = 0;

  constructor(options: InferenceHostOptions) {
    this.#options = options;
  }

  /** The setup every worker is started with. */
  get setup(): RuntimeSetup {
    return this.#options.setup;
  }

  /** How many workers run now. */
  get workers(): number {
    return this.#running.size;
  }

  /**
   * A new client, for a thread that runs models, told by `failed` when a
   * worker it is connected to has failed.
   */
  client(failed: InferenceFailed): InferenceClient {
    this.#clientsMade += 1;
    const id = this.#clientsMade;
    const client: Client = { failed, connected: new Set() };
    this.#clients.set(id, client);
    return {
      connect: (configuration, end) => {
        if (!this.#clients.has(id)) {
          // A thread that has gone asks nothing more; its end is let go.
          end.close();
          return;
        }
        const key = configurationKey(configuration);
        client.connected.add(key);
        this.#started(configuration).worker.postMessage(
          { kind: ToInferenceThreadKind.Connect, client: id, port: end },
          [end],
        );
      },
      disconnect: () => {
        if (!this.#clients.delete(id)) return;
        for (const key of client.connected) {
          this.#running
            .get(key)
            ?.worker.postMessage({ kind: ToInferenceThreadKind.Disconnect, client: id }, []);
        }
      },
    };
  }

  /** Ends every worker; each client's calls fail with the reason. */
  dispose(): void {
    for (const [key, running] of [...this.#running]) {
      this.#failed(key, running, 'The inference workers were closed.');
    }
    this.#clients.clear();
  }

  /** The worker that runs `configuration`, started with the setup where none runs. */
  #started(configuration: RuntimeConfiguration): Running {
    const key = configurationKey(configuration);
    const known = this.#running.get(key);
    if (known !== undefined) return known;
    const worker = this.#options.createWorker();
    const running: Running = { worker, configuration };
    worker.addEventListener('error', (event) => {
      this.#failed(
        key,
        running,
        event.message === '' ? 'The inference worker could not run.' : event.message,
      );
    });
    worker.postMessage({ kind: ToInferenceThreadKind.Start, setup: this.#options.setup }, []);
    this.#running.set(key, running);
    return running;
  }

  /** Ends a worker once, telling each client connected to it why. */
  #failed(key: string, running: Running, reason: string): void {
    if (this.#running.get(key) !== running) return;
    this.#running.delete(key);
    running.worker.terminate();
    for (const client of this.#clients.values()) {
      if (client.connected.delete(key)) client.failed(running.configuration, reason);
    }
  }
}
