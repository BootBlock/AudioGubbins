/**
 * The codec worker's requests as jobs: who asked, what was asked and what
 * cancels it; the queue that runs them one at a time in the order taken; the
 * one answer each gets; and the ending of the streams of one that never ran,
 * so the storage and render workers waiting on them stop waiting.
 */

import type { CancellationSource, DomainFailure } from '@audiogubbins/domain';
import type { DecodedStreamMessage, EncodedStreamMessage } from '@audiogubbins/import-export';

import { refuseStream } from '../streams/credited-receiver.js';
import { CreditedSender } from '../streams/credited-sender.js';
import {
  FromCodecWorkerKind,
  ToCodecWorkerKind,
  type CodecRequest,
  type FromCodecWorker,
} from './codec-worker-messages.js';
import type { JobEnd } from './job-end.js';

/** A context that asks the worker for work, and how it is answered. */
export interface Client {
  readonly post: (message: FromCodecWorker) => void;
}

/** A request taken, and what cancels it. */
export interface Job {
  readonly client: Client;
  readonly request: Exclude<CodecRequest, { readonly kind: 'cancel' }>;
  readonly cancellation: CancellationSource;
}

/** A queue of jobs, run one at a time in the order taken. */
export class JobQueue {
  readonly #waiting: Job[] = [];
  readonly #run: (job: Job) => Promise<void>;
  #running: Job | undefined;

  constructor(run: (job: Job) => Promise<void>) {
    this.#run = run;
  }

  add(job: Job): void {
    this.#waiting.push(job);
    void this.#pump();
  }

  /** Takes every waiting job `matches` out of the queue, answering them. */
  withdraw(matches: (job: Job) => boolean): Job[] {
    const withdrawn = this.#waiting.filter(matches);
    for (const job of withdrawn) this.#waiting.splice(this.#waiting.indexOf(job), 1);
    return withdrawn;
  }

  /** The running job, if `matches` holds of it. */
  running(matches: (job: Job) => boolean): Job | undefined {
    return this.#running !== undefined && matches(this.#running) ? this.#running : undefined;
  }

  async #pump(): Promise<void> {
    if (this.#running !== undefined) return;
    for (let job = this.#waiting.shift(); job !== undefined; job = this.#waiting.shift()) {
      this.#running = job;
      await this.#run(job);
      this.#running = undefined;
    }
  }
}

/** Ends the streams of a request that never ran, so their other sides stop waiting. */
export async function abandonStreams(
  request: Job['request'],
  reason: DomainFailure,
): Promise<void> {
  if (request.kind === ToCodecWorkerKind.Analyse) return;
  if (request.kind === ToCodecWorkerKind.Encode) refuseStream(request.rendered, reason);
  const sender = new CreditedSender<DecodedStreamMessage | EncodedStreamMessage>(request.stream);
  await sender.send({ kind: 'failed', failure: reason }, []);
  sender.close();
}

/** The message that answers a request, which names it. */
function answerOf(request: string, end: JobEnd): FromCodecWorker {
  switch (end.kind) {
    case 'analysed':
      return { kind: FromCodecWorkerKind.Analysed, request, analysis: end.analysis };
    case 'decoded':
      return {
        kind: FromCodecWorkerKind.Decoded,
        request,
        frames: end.frames,
        decoder: end.decoder,
      };
    case 'encoded':
      return { kind: FromCodecWorkerKind.Encoded, request, frames: end.frames };
    case 'failed':
      return { kind: FromCodecWorkerKind.Failed, request, failure: end.failure };
    case 'cancelled':
      return { kind: FromCodecWorkerKind.Cancelled, request };
  }
}

/** Answers a job to the client that asked. */
export function answerJob(job: Job, end: JobEnd): void {
  job.client.post(answerOf(job.request.request, end));
}
