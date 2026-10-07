/**
 * The preview and render workers played in the test's own thread, for the
 * tests of the page that starts them: Node's test environment starts no
 * worker.
 *
 * Each is composed as its module composes it (`threads/preview-worker.ts`,
 * `threads/render-worker.ts`): the real core, running chains on the effect
 * rack over the processor types made with the thread's own model channel,
 * which its scope hands on before the core reads anything. A test may give
 * the types another way of being made, as a pack of stand-ins needs. Every
 * message crosses as it does between threads: a structured clone, its buffers
 * transferred and each channel's end carried as itself
 * (`fake-message-channel.ts`), delivered a turn of the event loop later. A
 * fault the core raises is thrown where it happens, so it fails the test
 * rather than reaching the page as the worker's error event.
 */

import { REFERENCE_DSP } from '@audiogubbins/audio-engine';
import { chainProcessing } from '@audiogubbins/effect-rack';
import { ModelChannel } from '@audiogubbins/ml-runtime';
import {
  processorTypesWith,
  type ModelServices,
  type ProcessorType,
} from '@audiogubbins/processors';

import { PreviewWorkerCore } from '../preview/preview-worker-core.js';
import { RenderWorkerCore } from '../render/render-worker-core.js';
import type { RenderWorkerEvents } from '../render/worker-render.js';
import { cloneAcross, fakeChannel } from './fake-message-channel.js';

/** How a thread makes its processor types from its model services. */
export type TypesWith = (services: ModelServices) => ReadonlyMap<string, ProcessorType>;

/** What a played worker posts to the page through. */
type PostToPage = (message: unknown, transfer: readonly unknown[]) => void;

/** A core, by the part its worker's scope calls. */
interface Core {
  receive(data: unknown): void;
}

/** A turn of the event loop, as a worker's message or yield takes. */
function turn(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function raise(error: unknown): never {
  throw error;
}

/** A thread that runs chains, played in this thread, as the page sees its `Worker`. */
export class LocalChainWorker {
  terminated = false;
  readonly #listeners: {
    [TType in keyof RenderWorkerEvents]: Set<(event: RenderWorkerEvents[TType]) => void>;
  } = { message: new Set(), messageerror: new Set(), error: new Set() };
  readonly #models = new ModelChannel(fakeChannel);
  readonly #core: Core;

  constructor(make: (models: ModelChannel, post: PostToPage) => Core) {
    this.#core = make(this.#models, (message, transfer) => {
      this.#toPage(message, transfer);
    });
  }

  postMessage(message: unknown, transfer: readonly unknown[] = []): void {
    const data = cloneAcross(message, transfer);
    setTimeout(() => {
      if (this.terminated) return;
      if (!this.#models.receive(data)) this.#core.receive(data);
    }, 0);
  }

  /** Hears the worker's messages; it raises no other event (see the module comment). */
  addEventListener<TType extends keyof RenderWorkerEvents>(
    type: TType,
    listener: (event: RenderWorkerEvents[TType]) => void,
  ): void {
    this.#listeners[type].add(listener);
  }

  removeEventListener<TType extends keyof RenderWorkerEvents>(
    type: TType,
    listener: (event: RenderWorkerEvents[TType]) => void,
  ): void {
    this.#listeners[type].delete(listener);
  }

  terminate(): void {
    this.terminated = true;
  }

  #toPage(message: unknown, transfer: readonly unknown[]): void {
    const data = cloneAcross(message, transfer);
    setTimeout(() => {
      if (this.terminated) return;
      const event = new MessageEvent('message', { data });
      for (const listener of [...this.#listeners.message]) listener(event);
    }, 0);
  }
}

/** The preview worker, as `threads/preview-worker.ts` composes it, its types made by `types`. */
export function localPreviewWorker(types: TypesWith = processorTypesWith): LocalChainWorker {
  return new LocalChainWorker(
    (models, post) =>
      new PreviewWorkerCore({
        post: (message) => {
          post(message, []);
        },
        schedule: (callback, milliseconds) => {
          const timer = setTimeout(callback, milliseconds);
          return () => {
            clearTimeout(timer);
          };
        },
        processing: chainProcessing(types({ inference: models, models })),
        dsp: REFERENCE_DSP,
        bound: 64 * 2 ** 20,
        concurrency: 2,
        reportFault: raise,
      }),
  );
}

/** A render worker, as `threads/render-worker.ts` composes it, its types made by `types`. */
export function localRenderWorker(types: TypesWith = processorTypesWith): LocalChainWorker {
  return new LocalChainWorker(
    (models, post) =>
      new RenderWorkerCore({
        post: (message, transfer) => {
          post(message, transfer);
        },
        yieldToHost: turn,
        reportFault: raise,
        processing: chainProcessing(types({ inference: models, models })),
      }),
  );
}
