/**
 * The page's end of the preview worker (ADR-0061): it starts the worker when a
 * worker that reads edited sound is first connected to it, makes each
 * connection's channel, and keeps how far each render has come for the
 * Transport panel to show.
 *
 * A connection is let go when the worker it serves goes, which is what lets
 * the preview worker give up the renders that worker held: a terminated
 * worker closes no port of its own. A reply that cannot be read, and an error
 * the worker's script threw, are recorded and leave the reports as they were,
 * since the renders they would have described are the workers' to fail.
 */

import type { Logger } from '@audiogubbins/diagnostics';
import type { CachePurpose, RenderReport } from '@audiogubbins/audio-engine';

import type { ChannelEnds } from '../playback/channel-ends.js';
import {
  ToPreviewWorkerKind,
  readFromPreviewWorker,
  type ToPreviewWorker,
} from '../protocol/preview-worker-messages.js';

/** The part of a `Worker` the host uses, so a test can play the worker. */
export interface PreviewWorkerPort {
  postMessage(message: ToPreviewWorker, transfer: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  addEventListener(type: 'messageerror', listener: () => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  terminate(): void;
}

/** How far the preview worker's renders have come. */
export interface PreviewRenders {
  /** Each render kept, the least recently used first. */
  readonly renders: readonly RenderReport[];
  /** How many renders were begun in all, each one pass of every whole pass it runs. */
  readonly begun: number;
}

/** A worker's connection to the preview worker. */
export interface PreviewConnection {
  /** The end the worker reads renders through, to transfer to it. */
  readonly port: MessagePort;
  /** Lets the preview worker give up what the worker held, once it has gone. */
  readonly disconnect: () => void;
}

/** What the host is made with. */
export interface PreviewHostOptions {
  /** Starts the preview worker, the module `threads/preview-worker.ts`. */
  readonly createWorker: () => PreviewWorkerPort;
  /** Makes a channel between a worker and the preview worker: a `MessageChannel`. */
  readonly createChannel: () => ChannelEnds;
  readonly logger: Logger;
}

const NOTHING_RENDERED: PreviewRenders = { renders: [], begun: 0 };

/** The page's end of the preview worker. */
export class PreviewHost {
  readonly #options: PreviewHostOptions;
  readonly #listeners = new Set<(renders: PreviewRenders) => void>();
  #worker: PreviewWorkerPort | undefined;
  #connections = 0;
  #renders: PreviewRenders = NOTHING_RENDERED;

  constructor(options: PreviewHostOptions) {
    this.#options = options;
  }

  /** How far the renders had come when the worker last said. */
  get renders(): PreviewRenders {
    return this.#renders;
  }

  /** Hears how far the renders have come each time the worker says, until the answer is called. */
  subscribe(listener: (renders: PreviewRenders) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** A new connection for a worker that reads renders for `purpose`. */
  connect(purpose: CachePurpose): PreviewConnection {
    const worker = this.#started();
    const { port1, port2 } = this.#options.createChannel();
    this.#connections += 1;
    const connection = this.#connections;
    worker.postMessage({ kind: ToPreviewWorkerKind.Connect, connection, purpose, port: port1 }, [
      port1,
    ]);
    let connected = true;
    return {
      port: port2,
      disconnect: () => {
        if (!connected || this.#worker !== worker) return;
        connected = false;
        worker.postMessage({ kind: ToPreviewWorkerKind.Disconnect, connection }, []);
      },
    };
  }

  /** Stops the worker, and every render with it. */
  dispose(): void {
    this.#worker?.terminate();
    this.#worker = undefined;
    this.#listeners.clear();
  }

  #started(): PreviewWorkerPort {
    if (this.#worker !== undefined) return this.#worker;
    const { logger } = this.#options;
    const worker = this.#options.createWorker();
    worker.addEventListener('message', (event) => {
      const read = readFromPreviewWorker(event.data);
      if (!read.ok) {
        logger.error('A report from the preview worker could not be read.', {
          reason: read.failures[0].summary,
        });
        return;
      }
      this.#renders = { renders: read.value.renders, begun: read.value.begun };
      for (const listener of [...this.#listeners]) listener(this.#renders);
    });
    worker.addEventListener('messageerror', () => {
      logger.error('A report from the preview worker could not be received.');
    });
    worker.addEventListener('error', (event) => {
      // Recorded here rather than left for the console; the workers reading
      // its renders fail their reads with their own reasons.
      event.preventDefault();
      logger.error('The preview worker stopped with an error.', { reason: event.message });
    });
    this.#worker = worker;
    return worker;
  }
}
