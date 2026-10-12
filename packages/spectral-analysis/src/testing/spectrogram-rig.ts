/**
 * The spectrogram worker and a cache, in the test's own thread.
 *
 * `LocalSpectrogramWorker` runs the real `SpectrogramWorkerCore` behind the
 * port the host talks to, cloning every message both ways with its transfers,
 * as a worker boundary does, and a turn of the event loop late, so the host is
 * tested against the worker's behaviour and not a stand-in for it. It is
 * composed as the worker's module composes it
 * (`threads/spectrogram-worker.ts`): the real effect rack over the processor
 * types made with the worker's own model channel, and the DSP chosen from the
 * delivery it is given as it is made, as the page gives one to each worker it
 * makes: the reference path unless a test delivers the compiled module.
 */

import {
  DspDeliveryKind,
  PcmDescriptionKind,
  deliveredDsp,
  type DspDelivery,
  type PcmDescription,
} from '@audiogubbins/audio-engine';
import { MAXIMUM_QUALITY, sampleRate } from '@audiogubbins/domain';
import { crossingThreads, expectSuccess } from '@audiogubbins/domain/testing';
import { chainProcessing } from '@audiogubbins/effect-rack';
import { ModelChannel, type ChannelPair } from '@audiogubbins/ml-runtime';
import { inProcessChannel } from '@audiogubbins/ml-runtime/testing';
import { processorTypesWith } from '@audiogubbins/processors';

import type { SpectrogramWorkerPort } from '../spectrogram-host.js';
import type { SpectralTileCache } from '../spectrogram-ports.js';
import {
  ToSpectrogramWorkerKind,
  type CompiledModule,
  type ToSpectrogramWorker,
} from '../spectrogram-messages.js';
import type { SpectrogramSubject } from '../spectrogram-subject.js';
import { tileKeyText, type SpectralTileKey } from '../spectral-tile.js';
import { SpectrogramWorkerCore } from '../spectrogram-worker-core.js';

/** The part of the host's WebAssembly the rig uses, as the worker's module declares it. */
declare const WebAssembly: {
  readonly Instance: new (module: object, imports: object) => { readonly exports: unknown };
};

/** How the worker is made: the DSP delivered to it. */
export interface LocalSpectrogramOptions {
  readonly dsp?: DspDelivery<CompiledModule>;
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

/** The spectrogram worker, run in this thread behind a cloning port. */
export class LocalSpectrogramWorker implements SpectrogramWorkerPort {
  readonly sent: ToSpectrogramWorker[] = [];
  /** The messages the worker posted, in order, as they were posted. */
  readonly posted: unknown[] = [];
  terminated = false;
  #onMessage: ((value: unknown) => void) | undefined;
  #onFault: ((reason: string) => void) | undefined;
  readonly #models = new ModelChannel(inProcessPair);
  readonly #core: SpectrogramWorkerCore;

  constructor(options: LocalSpectrogramOptions = {}) {
    this.#core = new SpectrogramWorkerCore({
      post: (message, transfer) => {
        this.posted.push(message);
        const cloned: unknown = structuredClone(message, { transfer: [...transfer] });
        setTimeout(() => this.#onMessage?.(cloned), 0);
      },
      yieldToHost: turn,
      processing: chainProcessing(
        processorTypesWith({ inference: this.#models, models: this.#models }),
      ),
      chooseDsp: (delivery) =>
        deliveredDsp(delivery, (module) => new WebAssembly.Instance(module, {}).exports),
      reportFault: (error) => {
        throw error;
      },
    });
    this.#deliver(
      {
        kind: ToSpectrogramWorkerKind.Dsp,
        delivery: options.dsp ?? {
          kind: DspDeliveryKind.Unavailable,
          reason: 'The test runs the reference DSP.',
        },
      },
      [],
    );
  }

  post(message: ToSpectrogramWorker, transfer: readonly ArrayBuffer[]): void {
    this.sent.push(message);
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

  /** The worker failing, as an error event reports it. */
  fault(reason: string): void {
    this.#onFault?.(reason);
  }

  terminate(): void {
    this.terminated = true;
  }
}

/** A cache kept in memory, counting its reads and writes, which a test can have refuse writes. */
export class MemoryTileCache implements SpectralTileCache {
  readonly kept = new Map<string, Uint8Array<ArrayBuffer>>();
  reads = 0;
  writes = 0;
  /** Why a write is refused, while one is. */
  refusing: string | undefined;

  read(key: SpectralTileKey): Promise<Uint8Array<ArrayBuffer> | undefined> {
    this.reads += 1;
    return Promise.resolve(this.kept.get(tileKeyText(key))?.slice());
  }

  write(key: SpectralTileKey, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    this.writes += 1;
    if (this.refusing !== undefined) return Promise.reject(new Error(this.refusing));
    this.kept.set(tileKeyText(key), bytes.slice());
    return Promise.resolve();
  }
}

/** A subject whose audio is `channels`, planar, at 48 kHz, copied each time it is described. */
export function memorySubject(
  identity: string,
  channels: readonly Float32Array[],
  revision = '1',
): SpectrogramSubject {
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
    describe,
    quality: MAXIMUM_QUALITY,
  };
}
