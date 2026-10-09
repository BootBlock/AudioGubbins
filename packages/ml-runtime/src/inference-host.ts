/**
 * The page's end of the inference worker (ADR-0062): one worker for the whole
 * application, started when a thread first connects to it and started with
 * the runtime's setup.
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
 * host tells the worker to let its sessions go, since a terminated thread
 * closes no channel. A worker that fails is ended and forgotten, and each
 * client connected to it is told why, so its waiting calls fail with the
 * reason rather than wait; the next connection starts a new one.
 */

import type { ChannelEnd } from './channel-end.js';
import type { RuntimeSetup } from './inference-options.js';
import { ToInferenceThreadKind, type ToInferenceThread } from './protocol/inference-messages.js';

/** The part of a `Worker` the host uses, so a test can play the worker. */
export interface InferenceThreadPort {
  postMessage(message: ToInferenceThread, transfer: readonly object[]): void;
  addEventListener(type: 'error', listener: (event: { readonly message: string }) => void): void;
  terminate(): void;
}

/** A thread's place among the host's clients. */
export interface InferenceClient {
  /** Hands `end` to the inference worker, starting it if none runs. */
  connect(end: ChannelEnd): void;
  /** Lets every session the thread held go, once it has gone. */
  disconnect(): void;
}

/** What the host is made with. */
export interface InferenceHostOptions {
  /** Starts an inference worker, the module `threads/inference-worker.ts`. */
  readonly createWorker: () => InferenceThreadPort;
  readonly setup: RuntimeSetup;
}

/** How a client hears that the worker it is connected to failed, and why. */
export type InferenceFailed = (reason: string) => void;

/** A client, and how it hears that the worker it is connected to failed. */
interface Client {
  readonly failed: InferenceFailed;
  /** The worker it is connected to, where it is. */
  connected: InferenceThreadPort | undefined;
}

/** The page's end of the inference worker (see the module comment). */
export class InferenceHost {
  readonly #options: InferenceHostOptions;
  readonly #clients = new Map<number, Client>();
  #worker: InferenceThreadPort | undefined;
  #clientsMade = 0;

  constructor(options: InferenceHostOptions) {
    this.#options = options;
  }

  /** The setup the worker is started with. */
  get setup(): RuntimeSetup {
    return this.#options.setup;
  }

  /** Whether a worker runs now. */
  get running(): boolean {
    return this.#worker !== undefined;
  }

  /**
   * A new client, for a thread that runs models, told by `failed` when the
   * worker it is connected to has failed.
   */
  client(failed: InferenceFailed): InferenceClient {
    this.#clientsMade += 1;
    const id = this.#clientsMade;
    const client: Client = { failed, connected: undefined };
    this.#clients.set(id, client);
    return {
      connect: (end) => {
        if (!this.#clients.has(id)) {
          // A thread that has gone asks nothing more; its end is let go.
          end.close();
          return;
        }
        const worker = this.#started();
        client.connected = worker;
        worker.postMessage({ kind: ToInferenceThreadKind.Connect, client: id, port: end }, [end]);
      },
      disconnect: () => {
        if (!this.#clients.delete(id)) return;
        client.connected?.postMessage({ kind: ToInferenceThreadKind.Disconnect, client: id }, []);
      },
    };
  }

  /** Ends the worker; each client's calls fail with the reason. */
  dispose(): void {
    if (this.#worker !== undefined) this.#failed(this.#worker, 'The inference worker was closed.');
    this.#clients.clear();
  }

  /** The worker, started with the setup where none runs. */
  #started(): InferenceThreadPort {
    if (this.#worker !== undefined) return this.#worker;
    const worker = this.#options.createWorker();
    worker.addEventListener('error', (event) => {
      this.#failed(
        worker,
        event.message === '' ? 'The inference worker could not run.' : event.message,
      );
    });
    worker.postMessage({ kind: ToInferenceThreadKind.Start, setup: this.#options.setup }, []);
    this.#worker = worker;
    return worker;
  }

  /** Ends a worker once, telling each client connected to it why. */
  #failed(worker: InferenceThreadPort, reason: string): void {
    if (this.#worker !== worker) return;
    this.#worker = undefined;
    worker.terminate();
    for (const client of this.#clients.values()) {
      if (client.connected !== worker) continue;
      client.connected = undefined;
      client.failed(reason);
    }
  }
}
