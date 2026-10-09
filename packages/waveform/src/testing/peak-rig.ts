/**
 * The peak worker and a cache, in the test's own thread.
 *
 * `LocalPeakWorker` runs the real `PeakWorkerCore` behind the port the host
 * talks to, cloning every message both ways with its transfers, as a worker
 * boundary does, and a turn of the event loop late, so the host is tested
 * against the worker's behaviour and not a stand-in for it. It is composed as
 * the worker's module composes it (`threads/peak-worker.ts`): the real effect
 * rack over the processor types made with the worker's own model channel,
 * which it hands on before the core reads anything, on the reference DSP. A
 * channel's end in a message, the preview worker's or the model channel's,
 * crosses as itself, as a port is transferred. A test may give the types
 * another way of being made, as a pack of stand-ins needs, and the channels
 * the model channel makes.
 */

import { REFERENCE_DSP, PcmDescriptionKind, type PcmDescription } from '@audiogubbins/audio-engine';
import { crossingThreads } from '@audiogubbins/audio-engine/testing';
import { MAXIMUM_QUALITY, sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { chainProcessing } from '@audiogubbins/effect-rack';
import { ModelChannel, type ChannelPair } from '@audiogubbins/ml-runtime';
import { inProcessChannel } from '@audiogubbins/ml-runtime/testing';
import {
  processorTypesWith,
  type ModelServices,
  type ProcessorType,
} from '@audiogubbins/processors';

import type { PeakCacheStore, PeakWorkerPort } from '../peak-host.js';
import type { ToPeakWorker } from '../peak-messages.js';
import type { PeakSubject } from '../peak-subject.js';
import { PeakWorkerCore } from '../peak-worker-core.js';

/** How the worker is made: its types from its model services, and its model channel's channels. */
export interface LocalPeakOptions {
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

/** The peak worker, run in this thread behind a cloning port. */
export class LocalPeakWorker implements PeakWorkerPort {
  readonly sent: ToPeakWorker[] = [];
  /** The kinds of the messages the worker posted, in order. */
  readonly posted: string[] = [];
  terminated = false;
  #onMessage: ((value: unknown) => void) | undefined;
  #onFault: ((reason: string) => void) | undefined;
  readonly #models: ModelChannel;
  readonly #core: PeakWorkerCore;
  /** The worker's clock, which a test moves to make a batch of runs due. */
  clock = 0;

  constructor(options: LocalPeakOptions = {}) {
    this.#models = new ModelChannel(options.createChannel ?? inProcessPair);
    const types = (options.types ?? processorTypesWith)({
      inference: this.#models,
      models: this.#models,
    });
    this.#core = new PeakWorkerCore({
      post: (message, transfer) => {
        this.posted.push(message.kind);
        const cloned: unknown = structuredClone(message, { transfer: [...transfer] });
        setTimeout(() => this.#onMessage?.(cloned), 0);
      },
      yieldToHost: turn,
      dsp: REFERENCE_DSP,
      processing: chainProcessing(types),
      reportFault: (error) => {
        throw error;
      },
      now: () => this.clock,
    });
  }

  post(message: ToPeakWorker, transfer: readonly ArrayBuffer[]): void {
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

/** A cache kept in memory, counting its reads and writes. */
export class MemoryPeakCache implements PeakCacheStore {
  readonly kept = new Map<string, Uint8Array<ArrayBuffer>>();
  reads = 0;
  writes = 0;

  read(identity: string, revision: string): Promise<Uint8Array<ArrayBuffer> | undefined> {
    this.reads += 1;
    const bytes = this.kept.get(`${identity}/${revision}`);
    return Promise.resolve(bytes === undefined ? undefined : bytes.slice());
  }

  write(identity: string, revision: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    this.writes += 1;
    this.kept.set(`${identity}/${revision}`, bytes.slice());
    return Promise.resolve();
  }
}

/** A subject whose audio is `channels`, planar, at 48 kHz, copied each time it is described. */
export function memorySubject(
  identity: string,
  channels: readonly Float32Array[],
  revision = '1',
): PeakSubject {
  const describe = (): PcmDescription => ({
    kind: PcmDescriptionKind.Pcm,
    sampleRate: expectSuccess(sampleRate(48_000)),
    channels: channels.map((channel) => channel.slice()),
  });
  return {
    identity,
    revision,
    channels: channels.length,
    frames: channels[0]?.length ?? 0,
    sampleRate: 48_000,
    describe,
    quality: MAXIMUM_QUALITY,
  };
}
