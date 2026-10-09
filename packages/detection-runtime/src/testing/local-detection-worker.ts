/**
 * The detection worker in the test's own thread.
 *
 * `LocalDetectionWorker` runs the real `DetectionWorkerCore` behind the port
 * the host talks to, cloning every message both ways with its transfers, as a
 * worker boundary does, and a turn of the event loop late, so the host and the
 * application are tested against the worker's behaviour and not a stand-in for
 * it. It is composed as the worker's module composes it: the real effect rack,
 * assistants and processor types, on the reference DSP, the types made with the
 * worker's own model channel, which it hands on before the core reads anything.
 * A channel's end in a message, the preview worker's or the model channel's,
 * crosses as itself, as a port is transferred. A test may give the types
 * another way of being made, as a pack of stand-ins needs, and the channels the
 * model channel makes.
 */

import { REFERENCE_DSP } from '@audiogubbins/audio-engine';
import { crossingThreads } from '@audiogubbins/audio-engine/testing';
import { chainProcessing } from '@audiogubbins/effect-rack';
import { ModelChannel, type ChannelPair } from '@audiogubbins/ml-runtime';
import { inProcessChannel } from '@audiogubbins/ml-runtime/testing';
import {
  CLASSIFICATION_ASSISTANT,
  REPAIR_ASSISTANT,
  RESTORATION_ASSISTANT,
  processorTypesWith,
  type ModelServices,
  type ProcessorType,
} from '@audiogubbins/processors';

import type { DetectionWorkerPort } from '../detection-host.js';
import type { ToDetectionWorker } from '../detection-messages.js';
import { DetectionWorkerCore } from '../detection-worker-core.js';

/** How the worker is made: its types from its model services, and its model channel's channels. */
export interface LocalDetectionOptions {
  readonly types?: (services: ModelServices) => ReadonlyMap<string, ProcessorType>;
  readonly createChannel?: () => ChannelPair;
}

/** Two joined ends of the inference workers' played channel. */
function inProcessPair(): ChannelPair {
  const [port1, port2] = inProcessChannel();
  return { port1, port2 };
}

/** A turn of the event loop, as a worker's message takes. */
export function turn(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** The detection worker, run in this thread behind a cloning port. */
export class LocalDetectionWorker implements DetectionWorkerPort {
  readonly sent: ToDetectionWorker[] = [];
  /** The kinds of the messages the worker posted, in order. */
  readonly posted: string[] = [];
  terminated = false;
  #onMessage: ((value: unknown) => void) | undefined;
  #onFault: ((reason: string) => void) | undefined;
  readonly #core: DetectionWorkerCore;
  readonly #models: ModelChannel;

  constructor(options: LocalDetectionOptions = {}) {
    this.#models = new ModelChannel(options.createChannel ?? inProcessPair);
    const types = (options.types ?? processorTypesWith)({
      inference: this.#models,
      models: this.#models,
    });
    this.#core = new DetectionWorkerCore({
      post: (message) => {
        this.posted.push(message.kind);
        const cloned: unknown = structuredClone(message);
        setTimeout(() => this.#onMessage?.(cloned), 0);
      },
      yieldToHost: turn,
      dsp: REFERENCE_DSP,
      processing: chainProcessing(types),
      assistants: [CLASSIFICATION_ASSISTANT, REPAIR_ASSISTANT, RESTORATION_ASSISTANT],
      types,
      reportFault: (error) => {
        throw error;
      },
    });
  }

  post(message: ToDetectionWorker, transfer: readonly ArrayBuffer[]): void {
    this.sent.push(message);
    this.#deliver(message, transfer);
  }

  /** Takes a message to the worker's scope, as a `Worker` does: the page's model channel. */
  postMessage(message: unknown, transfer: readonly unknown[]): void {
    this.#deliver(message, transfer);
  }

  #deliver(message: unknown, transfer: readonly unknown[]): void {
    const cloned = crossingThreads(message, transfer);
    setTimeout(() => {
      if (!this.#models.receive(cloned)) this.#core.receive(cloned);
    }, 0);
  }

  listen(onMessage: (value: unknown) => void, onFault: (reason: string) => void): void {
    this.#onMessage = onMessage;
    this.#onFault = onFault;
  }

  /** How many messages of `kind` the worker posted. */
  answered(kind: string): number {
    return this.posted.filter((one) => one === kind).length;
  }

  /** The worker failing, as an error event reports it. */
  fault(reason: string): void {
    this.#onFault?.(reason);
  }

  terminate(): void {
    this.terminated = true;
  }
}
