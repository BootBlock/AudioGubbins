/**
 * The page's end of every model channel (ADR-0062): it connects each thread
 * that runs chains to the inference worker and to the installed packs'
 * files, and serves what the thread asks over its channel.
 *
 * A thread's request for a connection to the inference worker is handed to the
 * inference host with the end the thread made, so the thread then talks to the
 * worker directly. A request for a file is read through the page's model
 * library, which reads it from the storage and takes its SHA-256 as it reads,
 * and answered with the bytes transferred; a call the thread cancels is
 * cancelled. When the worker the thread is connected to fails, the thread is
 * told why. Once the thread has gone, its connection is let go: its calls are
 * cancelled and the inference worker lets its sessions go, since a terminated
 * thread closes no channel.
 */

import {
  FailureKind,
  createCancellationSource,
  failure,
  type CancellationSignal,
  type CancellationSource,
  type DomainResult,
} from '@audiogubbins/domain';

import type { ChannelEnd } from './channel-end.js';
import type { InferenceClient, InferenceHost } from './inference-host.js';
import type { InferenceCapabilities } from './inference-options.js';
import type { ChannelPair, ModelFileRead } from './model-channel.js';
import {
  FromModelThreadKind,
  MODEL_CHANNEL,
  ToModelChannelKind,
  type FromModelThread,
  type ToModelChannel,
  type ToModelThread,
} from './protocol/model-channel-messages.js';
import { readFromModelThread } from './protocol/model-channel-reading.js';

/** Reads a file of an installed pack, with its SHA-256 taken as it is read. */
export type ModelFileReader = (
  pack: string,
  version: string,
  path: string,
  signal: CancellationSignal,
) => Promise<DomainResult<ModelFileRead>>;

/** What the page's end is made with. */
export interface ModelThreadsOptions {
  /**
   * The inference worker's host, made when a thread first asks for a
   * connection, so a page that runs no model loads nothing of the runtime's.
   */
  readonly inference: () => Promise<InferenceHost>;
  /** What the device offers the runtime, as the host starts its workers with it. */
  readonly capabilities: InferenceCapabilities;
  readonly files: ModelFileReader;
  /** Makes a channel between the page and a thread: a `MessageChannel`. */
  readonly createChannel: () => ChannelPair;
  /** Records a message from a thread that could not be read, which no thread can be told of. */
  readonly reportFault: (summary: string) => void;
}

/** A thread that runs chains, as a `Worker` is, by the part used to connect it. */
export interface ModelThread {
  postMessage(message: ToModelThread, transfer: readonly object[]): void;
}

/** The bytes as a transfer can carry them: alone in their buffer, so nothing around them moves. */
function movableBytes(bytes: ModelFileRead['bytes']): ModelFileRead['bytes'] {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes
    : bytes.slice();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One thread's model channel, as the page serves it. */
class ThreadConnection {
  readonly #options: ModelThreadsOptions;
  readonly #page: ChannelEnd;
  readonly #calls = new Map<number, CancellationSource>();
  #client: Promise<InferenceClient> | undefined;
  #connected = true;

  constructor(options: ModelThreadsOptions, page: ChannelEnd) {
    this.#options = options;
    this.#page = page;
    page.addEventListener('message', (event) => {
      this.#receive(event.data);
    });
    page.addEventListener('messageerror', () => {
      options.reportFault("A thread's message on its model channel could not be received.");
    });
    page.start();
  }

  /** Lets go of everything the thread held. */
  disconnect(): void {
    if (!this.#connected) return;
    this.#connected = false;
    for (const source of this.#calls.values()) source.cancel();
    this.#calls.clear();
    // A host that could not be made holds nothing of the thread's, and its
    // failure was answered to the thread when it asked.
    this.#client?.then(
      (made) => {
        made.disconnect();
      },
      () => undefined,
    );
    this.#page.close();
  }

  #receive(value: unknown): void {
    const read = readFromModelThread(value);
    if (!read.ok) {
      this.#options.reportFault(
        `A thread's message on its model channel could not be read: ${read.failures[0].summary}`,
      );
      return;
    }
    const message = read.value;
    switch (message.kind) {
      case FromModelThreadKind.Inference:
        this.#connectInference(message.port);
        return;
      case FromModelThreadKind.Cancel:
        this.#calls.get(message.call)?.cancel();
        this.#calls.delete(message.call);
        return;
      case FromModelThreadKind.File:
        this.#readFile(message);
        return;
    }
  }

  /** The thread's client of the inference host, made with the host on the first request. */
  #clientOf(): Promise<InferenceClient> {
    this.#client ??= this.#options.inference().then((host) =>
      host.client((reason) => {
        this.#post({ kind: ToModelChannelKind.InferenceFailed, reason }, []);
      }),
    );
    return this.#client;
  }

  /** Hands `port` on to the inference worker, in the order asked. */
  #connectInference(port: ChannelEnd): void {
    this.#clientOf().then(
      (client) => {
        if (this.#connected) client.connect(port);
        else port.close();
      },
      (error: unknown) => {
        port.close();
        this.#post(
          {
            kind: ToModelChannelKind.InferenceFailed,
            reason: `The inference runtime could not be set up: ${messageOf(error)}`,
          },
          [],
        );
      },
    );
  }

  /** Reads a file through the page's library and answers the call, unless it was cancelled. */
  #readFile({
    call,
    pack,
    version,
    path,
  }: Extract<FromModelThread, { kind: typeof FromModelThreadKind.File }>): void {
    const source = createCancellationSource();
    this.#calls.set(call, source);
    const answer = (message: ToModelChannel, transfer: readonly object[]): void => {
      if (this.#calls.get(call) !== source) return;
      this.#calls.delete(call);
      this.#post(message, transfer);
    };
    this.#options.files(pack, version, path, source.signal).then(
      (read) => {
        if (!read.ok) {
          answer({ kind: ToModelChannelKind.FileFailed, call, failures: read.failures }, []);
          return;
        }
        const bytes = movableBytes(read.value.bytes);
        answer({ kind: ToModelChannelKind.File, call, bytes, sha256: read.value.sha256 }, [
          bytes.buffer,
        ]);
      },
      (error: unknown) => {
        // The reader's contract is to answer, never to throw; the thread
        // would otherwise wait on the call for ever.
        answer(
          {
            kind: ToModelChannelKind.FileFailed,
            call,
            failures: [
              failure(
                'inference.file-read-failed',
                FailureKind.Unrecoverable,
                `The model file could not be read: ${messageOf(error)}`,
              ),
            ],
          },
          [],
        );
      },
    );
  }

  #post(message: ToModelChannel, transfer: readonly object[]): void {
    if (this.#connected) this.#page.postMessage(message, transfer);
  }
}

/** The page's end of every model channel (see the module comment). */
export class ModelThreads {
  readonly #options: ModelThreadsOptions;

  constructor(options: ModelThreadsOptions) {
    this.#options = options;
  }

  /**
   * Connects `thread`, as it starts, to its model channel, and answers what
   * lets go of everything it held once it has gone.
   */
  connect(thread: ModelThread): () => void {
    const { port1: page, port2: end } = this.#options.createChannel();
    const connection = new ThreadConnection(this.#options, page);
    thread.postMessage(
      { kind: MODEL_CHANNEL, port: end, capabilities: this.#options.capabilities },
      [end],
    );
    return () => {
      connection.disconnect();
    };
  }
}
