/**
 * The detection worker in the test's own thread.
 *
 * `LocalDetectionWorker` runs the real `DetectionWorkerCore` behind the port
 * the host talks to, cloning every message both ways with its transfers, as a
 * worker boundary does, and a turn of the event loop late, so the host and
 * the application are tested against the worker's behaviour and not a
 * stand-in for it. It is composed as the worker's module composes it: the
 * real effect rack, assistants and processor types, on the reference DSP.
 */

import { REFERENCE_DSP } from '@audiogubbins/audio-engine';
import { chainProcessing } from '@audiogubbins/effect-rack';
import {
  CLASSIFICATION_ASSISTANT,
  PROCESSOR_TYPES_BY_KEY,
  REPAIR_ASSISTANT,
  RESTORATION_ASSISTANT,
} from '@audiogubbins/processors';

import type { DetectionWorkerPort } from '../detection-host.js';
import type { ToDetectionWorker } from '../detection-messages.js';
import { DetectionWorkerCore } from '../detection-worker-core.js';

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

  constructor() {
    this.#core = new DetectionWorkerCore({
      post: (message) => {
        this.posted.push(message.kind);
        const cloned: unknown = structuredClone(message);
        setTimeout(() => this.#onMessage?.(cloned), 0);
      },
      yieldToHost: turn,
      dsp: REFERENCE_DSP,
      processing: chainProcessing(PROCESSOR_TYPES_BY_KEY),
      assistants: [CLASSIFICATION_ASSISTANT, REPAIR_ASSISTANT, RESTORATION_ASSISTANT],
      types: PROCESSOR_TYPES_BY_KEY,
      reportFault: (error) => {
        throw error;
      },
    });
  }

  post(message: ToDetectionWorker, transfer: readonly ArrayBuffer[]): void {
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
