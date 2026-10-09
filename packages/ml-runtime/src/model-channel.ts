/**
 * A thread's end of its model channel (ADR-0062): what a thread that runs
 * chains reaches the inference workers and the installed packs' files
 * through, as the inference port and the file reads a model library makes.
 *
 * The thread makes it as it starts, so the processor types it runs chains with
 * are made once with it, and the page connects it with the first message it
 * sends the thread's scope (`MODEL_CHANNEL`), which the thread hands here
 * before its own protocol reads anything. Inference runs through a
 * `WorkerInference` whose connection to the worker is a channel this thread
 * makes and the page hands on, so tensors go straight to the worker; a file is
 * asked of the page, which reads it from the storage and answers with its bytes
 * and their SHA-256, transferred. Until the page connects it, and after the
 * channel fails, every call is answered with why.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type CancellationSignal,
  type DomainFailureResult,
  type DomainResult,
} from '@audiogubbins/domain';

import type { ChannelEnd } from './channel-end.js';
import { channelWorkerPort } from './channel-worker-port.js';
import type { InferenceOptions } from './inference-options.js';
import {
  cancelled,
  type InferencePort,
  type InferenceSession,
  type ModelBytes,
  type ModelSource,
} from './inference-port.js';
import {
  FromModelThreadKind,
  ToModelChannelKind,
  type FromModelThread,
} from './protocol/model-channel-messages.js';
import {
  isModelChannelMessage,
  readToModelChannel,
  readToModelThread,
} from './protocol/model-channel-reading.js';
import { WorkerInference } from './worker-inference.js';

/** A file of an installed pack, read whole, with the SHA-256 taken as it was read. */
export interface ModelFileRead {
  readonly bytes: ModelBytes;
  readonly sha256: string;
}

/** The two ends of a new channel, as `MessageChannel` makes them. */
export interface ChannelPair {
  readonly port1: ChannelEnd;
  readonly port2: ChannelEnd;
}

function channelFailed(summary: string): DomainFailureResult {
  return fail(failure('inference.channel-failed', FailureKind.Unrecoverable, summary));
}

const NOT_CONNECTED = channelFailed(
  'This thread was given no channel to the inference workers and the installed model packs.',
);

/** A call waiting for the page's answer. */
type Settle = (result: DomainResult<ModelFileRead>) => void;

/** A thread's end of its model channel (see the module comment). */
export class ModelChannel implements InferencePort {
  readonly #createChannel: () => ChannelPair;
  readonly #pending = new Map<number, Settle>();
  #end: ChannelEnd | undefined;
  #inference: WorkerInference | undefined;
  #calls = 0;
  /** Why the channel can no longer be used, once it cannot. */
  #failure: DomainFailureResult | undefined;

  constructor(createChannel: () => ChannelPair) {
    this.#createChannel = createChannel;
  }

  /**
   * Takes the page's connection where `value`, a message to the thread's
   * scope, is one, and answers whether it was, so the thread's own protocol
   * reads every other message. A connection that cannot be read, or a second
   * one, fails the channel with the reason.
   */
  receive(value: unknown): boolean {
    if (!isModelChannelMessage(value)) return false;
    const read = readToModelThread(value);
    if (!read.ok) {
      this.#fail(`The model channel's connection could not be read: ${read.failures[0].summary}`);
      return true;
    }
    const { port, capabilities } = read.value;
    if (this.#end !== undefined) {
      port.close();
      this.#fail('The thread was connected to a second model channel.');
      return true;
    }
    this.#end = port;
    port.addEventListener('message', (event) => {
      this.#receive(event.data);
    });
    port.addEventListener('messageerror', () => {
      this.#fail('A message from the page on the model channel could not be received.');
    });
    port.start();
    this.#inference = new WorkerInference({
      capabilities,
      connect: () => {
        const { port1, port2 } = this.#createChannel();
        this.#post({ kind: FromModelThreadKind.Inference, port: port2 }, [port2]);
        return channelWorkerPort(port1);
      },
    });
    return true;
  }

  open(
    model: ModelSource,
    options: InferenceOptions,
    signal?: CancellationSignal,
  ): Promise<DomainResult<InferenceSession>> {
    const inference = this.#inference;
    if (this.#failure !== undefined) return Promise.resolve(this.#failure);
    if (inference === undefined) return Promise.resolve(NOT_CONNECTED);
    return inference.open(model, options, signal);
  }

  /**
   * The file at `path` within version `version` of the installed pack `pack`,
   * with the SHA-256 of its bytes taken as they were read, or why it cannot be
   * had, as the page's model library answers.
   */
  file(
    pack: string,
    version: string,
    path: string,
    signal?: CancellationSignal,
  ): Promise<DomainResult<ModelFileRead>> {
    if (this.#failure !== undefined) return Promise.resolve(this.#failure);
    if (this.#end === undefined) return Promise.resolve(NOT_CONNECTED);
    if (signal?.aborted === true) return Promise.resolve(cancelled());
    this.#calls += 1;
    const call = this.#calls;
    return new Promise((resolve) => {
      const abort = (): void => {
        if (!this.#pending.delete(call)) return;
        this.#post({ kind: FromModelThreadKind.Cancel, call }, []);
        resolve(cancelled());
      };
      this.#pending.set(call, (result) => {
        signal?.removeEventListener('abort', abort);
        resolve(result);
      });
      signal?.addEventListener('abort', abort, { once: true });
      this.#post({ kind: FromModelThreadKind.File, call, pack, version, path }, []);
    });
  }

  #receive(value: unknown): void {
    const read = readToModelChannel(value);
    if (!read.ok) {
      this.#fail(`The page sent an answer that cannot be read: ${read.failures[0].summary}`);
      return;
    }
    const message = read.value;
    if (message.kind === ToModelChannelKind.InferenceFailed) {
      this.#inference?.failed(message.reason);
      return;
    }
    const settle = this.#pending.get(message.call);
    // A call answered here already, as cancelled.
    if (settle === undefined) return;
    this.#pending.delete(message.call);
    settle(
      message.kind === ToModelChannelKind.File
        ? succeed({ bytes: message.bytes, sha256: message.sha256 })
        : fail(...message.failures),
    );
  }

  #post(message: FromModelThread, transfer: readonly object[]): void {
    this.#end?.postMessage(message, transfer);
  }

  /** Fails the channel once: every call waiting and every one after is answered with why. */
  #fail(summary: string): void {
    if (this.#failure !== undefined) return;
    const failed = channelFailed(summary);
    this.#failure = failed;
    this.#inference?.dispose();
    this.#end?.close();
    for (const settle of this.#pending.values()) settle(failed);
    this.#pending.clear();
  }
}
