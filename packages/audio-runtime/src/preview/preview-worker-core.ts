/**
 * What the preview worker does with the messages the page sends it: it holds
 * the cached preview producer (ADR-0061), serves each connection the page
 * makes over its own channel, and tells the page how far each render has
 * come.
 *
 * The renders are made here, in a worker of their own, so neither the page nor
 * the feeder spends its time on a whole pass or a model, and every worker that
 * reads edited sound reads one render of a sound through its connection. The
 * worker's module (`threads/preview-worker.ts`) only connects this to its
 * global scope, so the whole of it runs in a Node test.
 */

import {
  PreviewProducer,
  PreviewService,
  previewPort,
  type CanonicalDsp,
  type ChainProcessing,
  type FromPreview,
} from '@audiogubbins/audio-engine';

import {
  FromPreviewWorkerKind,
  ToPreviewWorkerKind,
  readToPreviewWorker,
  type FromPreviewWorker,
} from '../protocol/preview-worker-messages.js';
import type { Schedule } from '../schedule.js';

/**
 * How often the page hears how far the renders have come, at most: often
 * enough for a progress reading to move smoothly, and not a message a chunk.
 */
const REPORT_MILLISECONDS = 100;

/** The worker's global scope, as the core uses it, and what it makes renders with. */
export interface PreviewWorkerHost {
  readonly post: (message: FromPreviewWorker) => void;
  readonly schedule: Schedule;
  readonly processing: ChainProcessing;
  readonly dsp: CanonicalDsp;
  /** The most bytes the renders kept may take. */
  readonly bound: number;
  /** The most renders made at once. */
  readonly concurrency: number;
  /**
   * Hears a fault: a message from the page that could not be read, a fault in
   * the page, or what a read threw that the engine does not throw on purpose.
   */
  readonly reportFault: (error: unknown) => void;
}

/** The preview worker's behaviour, given its host. */
export class PreviewWorkerCore {
  readonly #host: PreviewWorkerHost;
  readonly #producer: PreviewProducer;
  readonly #connections = new Map<number, PreviewService>();
  #reporting: (() => void) | undefined;

  constructor(host: PreviewWorkerHost) {
    this.#host = host;
    this.#producer = new PreviewProducer({
      processing: host.processing,
      dsp: host.dsp,
      bound: host.bound,
      concurrency: host.concurrency,
      changed: () => {
        this.#reportSoon();
      },
    });
  }

  /** Acts on a message from the page, whatever arrived. */
  receive(data: unknown): void {
    const read = readToPreviewWorker(data);
    if (!read.ok) {
      this.#host.reportFault(new Error(read.failures[0].summary));
      return;
    }
    const message = read.value;
    switch (message.kind) {
      case ToPreviewWorkerKind.Connect:
        this.#connections.get(message.connection)?.close();
        this.#connections.set(
          message.connection,
          new PreviewService(
            previewPort<FromPreview>(message.port),
            this.#producer.streams(message.purpose),
            this.#host.reportFault,
          ),
        );
        return;
      case ToPreviewWorkerKind.Disconnect:
        this.#connections.get(message.connection)?.close();
        this.#connections.delete(message.connection);
    }
  }

  /** Tells the page how far the renders have come, once the report interval has passed. */
  #reportSoon(): void {
    if (this.#reporting !== undefined) return;
    this.#reporting = this.#host.schedule(() => {
      this.#reporting = undefined;
      this.#host.post({
        kind: FromPreviewWorkerKind.Renders,
        renders: this.#producer.reports(),
        begun: this.#producer.rendersBegun,
      });
    }, REPORT_MILLISECONDS);
  }
}
