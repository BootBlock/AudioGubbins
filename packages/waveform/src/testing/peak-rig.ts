/**
 * The peak worker and a cache, in the test's own thread.
 *
 * `LocalPeakWorker` runs the real `PeakWorkerCore` behind the port the host
 * talks to, cloning every message both ways with its transfers, as a worker
 * boundary does, and a turn of the event loop late, so the host is tested
 * against the worker's behaviour and not a stand-in for it.
 */

import { REFERENCE_DSP, PcmDescriptionKind, type PcmDescription } from '@audiogubbins/audio-engine';
import { MAXIMUM_QUALITY, sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import type { PeakCacheStore, PeakWorkerPort } from '../peak-host.js';
import type { ToPeakWorker } from '../peak-messages.js';
import type { PeakSubject } from '../peak-subject.js';
import { PeakWorkerCore } from '../peak-worker-core.js';
import { NO_CHAIN_PROCESSING } from '@audiogubbins/audio-engine/testing';

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
  readonly #core = new PeakWorkerCore({
    post: (message, transfer) => {
      this.posted.push(message.kind);
      const cloned: unknown = structuredClone(message, { transfer: [...transfer] });
      setTimeout(() => this.#onMessage?.(cloned), 0);
    },
    yieldToHost: turn,
    dsp: REFERENCE_DSP,
    processing: NO_CHAIN_PROCESSING,
    reportFault: (error) => {
      throw error;
    },
    now: () => this.clock,
  });
  /** The worker's clock, which a test moves to make a batch of runs due. */
  clock = 0;

  post(message: ToPeakWorker, transfer: readonly ArrayBuffer[]): void {
    this.sent.push(message);
    const cloned: unknown = structuredClone(message, { transfer: [...transfer] });
    setTimeout(() => {
      this.#core.receive(cloned);
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
