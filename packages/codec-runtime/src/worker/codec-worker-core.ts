/**
 * What the codec worker does, apart from the scope it runs in (ADR-0090,
 * ADR-0091, ADR-0092).
 *
 * The worker's module (`threads/codec-worker.ts`) only connects this to its
 * global scope and hands it the scope's codec classes, file reader and the
 * export encoders' factory, so the whole of its behaviour runs in a test. The
 * page configures it once, with its compiled modules; each module loads on the
 * first request that needs it, and a load that fails makes only its own formats
 * unavailable. The browser's codecs are probed once, at start, and every
 * request waits for the probe, so no request is answered from a guess. The page
 * hears what the worker can do with each codec at first and whenever a load
 * changes it.
 *
 * Requests come from the page and from each client the page connects, each
 * named by its client and answered to it once: analysed, decoded, encoded,
 * failed or cancelled. Analyses run one at a time, and streams, decodes and
 * encodes, one at a time beside them, so the worker holds at most one
 * stream's blocks and one file's description in hand (G4); the rest wait in
 * the order asked. A cancelled request is answered at once where it waits,
 * its streams ended so their other side stops waiting, and at its next turn
 * where it runs.
 */

import type { CodecEnvironment, CodecId, ModuleLoad } from '@audiogubbins/codecs';
import type { CodecPlatform, CodecProbes } from '@audiogubbins/capabilities';
import {
  FailureKind,
  createCancellationSource,
  failure,
  type DomainFailure,
} from '@audiogubbins/domain';

import type { CodecModule } from '../codec-module.js';
import type { FileReaderSyncLike } from '../files/sync-file-bytes.js';
import { listen, type MessagePortLike } from '../streams/stream-port.js';
import { WORK_CANCELLED } from '../work-cancelled.js';
import { runAnalysis } from './analyse-job.js';
import {
  FromCodecWorkerKind,
  ToCodecWorkerKind,
  type CodecRequest,
  type FromCodecWorker,
  type ModuleSource,
  type EncoderModuleName,
} from './codec-worker-messages.js';
import { readCodecRequest, readToCodecWorker } from './codec-worker-message-reading.js';
import { runDecode } from './decode-job.js';
import { runEncode, type OpenExportEncoder } from './encode-job.js';
import type { ImportServices } from './import-opening.js';
import { endOfThrown, type JobContext, type JobEnd } from './job-end.js';
import { JobQueue, abandonStreams, answerJob, type Client, type Job } from './job-queue.js';
import { codecModuleLoad, encoderModuleLoad, type OnceLoaded } from './module-loading.js';

/** What the worker's scope gives the core. */
export interface CodecWorkerHost {
  /** Posts to the page that started the worker, moving `transfer`. */
  readonly post: (message: FromCodecWorker, transfer: ArrayBuffer[]) => void;
  /** Resolves after the events already queued for the worker have run. */
  readonly yieldToHost: () => Promise<void>;
  /** The scope's WebAssembly and codec classes, as capabilities read them. */
  readonly platform: CodecPlatform;
  /** Probes the browser's codecs, once. */
  readonly probe: () => Promise<CodecProbes>;
  readonly fileReader: FileReaderSyncLike;
  readonly openExportEncoder: OpenExportEncoder;
  /**
   * Raises a fault the core did not expect as an uncaught error of its
   * scope, which the page hears as the worker's `error` event.
   */
  readonly reportFault: (error: unknown) => void;
}

/** The modules, once the page has said where they are. */
interface Modules {
  readonly codec: OnceLoaded<CodecModule>;
  readonly encoders: Readonly<Record<EncoderModuleName, OnceLoaded<WebAssembly.Module>>>;
}

/** The encoder modules, by the codec each encodes. */
const ENCODER_MODULE_CODECS: Readonly<Record<EncoderModuleName, CodecId>> = {
  mp3: 'mp3',
  vorbis: 'vorbis',
};

const ENCODER_MODULES: readonly EncoderModuleName[] = ['mp3', 'vorbis'];

const UNCONFIGURED: DomainFailure = failure(
  'codec-runtime.worker-unconfigured',
  FailureKind.Rejected,
  'The codec worker was asked for work before it was told where its modules are.',
);

const UNREADABLE: DomainFailure = failure(
  'codec-runtime.message-unreadable',
  FailureKind.Rejected,
  'A message to the codec worker could not be read.',
);

/** The failure a request ends with where the worker met a fault, which it also raises. */
const FAULT: DomainFailure = failure(
  'codec-runtime.fault',
  FailureKind.Unrecoverable,
  'The codec worker met a fault it did not expect.',
);

/** The codec worker's work, given its scope's parts. */
export class CodecWorkerCore {
  readonly #host: CodecWorkerHost;
  readonly #probed: Promise<CodecProbes>;
  readonly #analyses: JobQueue;
  readonly #streams: JobQueue;
  readonly #page: Client;
  #probes: CodecProbes;
  #modules: Modules | undefined;

  constructor(host: CodecWorkerHost) {
    this.#host = host;
    this.#page = {
      post: (message) => {
        host.post(message, []);
      },
    };
    this.#probes = {
      webAssembly: host.platform.webAssembly,
      browserDecoders: new Set(),
      browserEncoders: new Set(),
    };
    this.#probed = host.probe().then((probes) => {
      this.#probes = probes;
      this.#tellEnvironment();
      return probes;
    });
    this.#analyses = new JobQueue((job) => this.#runJob(job));
    this.#streams = new JobQueue((job) => this.#runJob(job));
  }

  /** What the worker can do with each codec now. */
  environment(): CodecEnvironment {
    const encoders = new Map<CodecId, ModuleLoad>();
    for (const encoder of ENCODER_MODULES) {
      const state = this.#modules?.encoders[encoder].state ?? 'not-loaded';
      if (state !== 'not-loaded') encoders.set(ENCODER_MODULE_CODECS[encoder], state);
    }
    return {
      ...this.#probes,
      codecModule: this.#modules?.codec.state ?? 'not-loaded',
      encoderModules: encoders,
    };
  }

  #tellEnvironment(): void {
    this.#page.post({ kind: FromCodecWorkerKind.Environment, environment: this.environment() });
  }

  /** Acts on a message from the page. */
  receive(data: unknown): void {
    const read = readToCodecWorker(data);
    if (!read.ok) {
      this.#page.post({ kind: FromCodecWorkerKind.Refused, failure: read.failures[0] });
      return;
    }
    const message = read.value;
    switch (message.kind) {
      case ToCodecWorkerKind.Configure:
        this.#configure(message.codecModule, message.encoderModules);
        return;
      case ToCodecWorkerKind.Connect:
        this.#connect(message.port);
        return;
      default:
        this.#take(this.#page, message);
    }
  }

  /** Says that a message from the page could not be deserialised, which names no request. */
  messageFailed(): void {
    this.#page.post({ kind: FromCodecWorkerKind.Refused, failure: UNREADABLE });
  }

  #configure(
    codecModule: ModuleSource,
    encoderSources: Readonly<Record<EncoderModuleName, ModuleSource>>,
  ): void {
    if (this.#modules !== undefined) {
      this.#page.post({
        kind: FromCodecWorkerKind.Refused,
        failure: failure(
          'codec-runtime.worker-configured',
          FailureKind.Conflict,
          'The codec worker was told where its modules are a second time; it keeps the first.',
        ),
      });
      return;
    }
    const changed = (): void => {
      this.#tellEnvironment();
    };
    this.#modules = {
      codec: codecModuleLoad(codecModule, changed),
      encoders: {
        mp3: encoderModuleLoad('MP3', encoderSources.mp3, changed),
        vorbis: encoderModuleLoad('Vorbis', encoderSources.vorbis, changed),
      },
    };
  }

  /** Serves another client's requests over `port`. */
  #connect(port: MessagePortLike): void {
    const client: Client = {
      post: (message) => {
        port.postMessage(message, []);
      },
    };
    listen(
      port,
      (data) => {
        const read = readCodecRequest(data);
        if (read.ok) this.#take(client, read.value);
        else client.post({ kind: FromCodecWorkerKind.Refused, failure: read.failures[0] });
      },
      () => {
        client.post({ kind: FromCodecWorkerKind.Refused, failure: UNREADABLE });
      },
    );
  }

  #take(client: Client, request: CodecRequest): void {
    if (request.kind === ToCodecWorkerKind.Cancel) {
      this.#cancel(client, request.request);
      return;
    }
    const job: Job = { client, request, cancellation: createCancellationSource() };
    if (this.#modules === undefined) {
      answerJob(job, { kind: 'failed', failure: UNCONFIGURED });
      void abandonStreams(job.request, UNCONFIGURED);
      return;
    }
    (request.kind === ToCodecWorkerKind.Analyse ? this.#analyses : this.#streams).add(job);
  }

  #cancel(client: Client, request: string): void {
    const matches = (job: Job): boolean => job.client === client && job.request.request === request;
    for (const job of [...this.#analyses.withdraw(matches), ...this.#streams.withdraw(matches)]) {
      answerJob(job, { kind: 'cancelled' });
      void abandonStreams(job.request, WORK_CANCELLED);
    }
    for (const job of [this.#analyses.running(matches), this.#streams.running(matches)]) {
      job?.cancellation.cancel();
    }
  }

  /** The services a request uses, over the configured modules. */
  #services(modules: Modules): ImportServices {
    return {
      codecModule: () => modules.codec.get(),
      environment: () => this.environment(),
      platform: this.#host.platform,
    };
  }

  async #runJob(job: Job): Promise<void> {
    const modules = this.#modules;
    if (modules === undefined) return;
    await this.#probed;
    const { signal } = job.cancellation;
    const context: JobContext = {
      signal,
      yieldToHost: this.#host.yieldToHost,
      progress: (frames) => {
        job.client.post({
          kind: FromCodecWorkerKind.Progress,
          request: job.request.request,
          frames,
        });
      },
    };
    try {
      answerJob(job, await this.#perform(job, modules, context));
    } catch (error) {
      const end = endOfThrown(error, signal);
      if (end !== undefined) {
        answerJob(job, end);
        return;
      }
      answerJob(job, { kind: 'failed', failure: FAULT });
      this.#host.reportFault(error);
    }
  }

  #perform(job: Job, modules: Modules, context: JobContext): Promise<JobEnd> {
    const { request } = job;
    const reader = this.#host.fileReader;
    const services = this.#services(modules);
    switch (request.kind) {
      case ToCodecWorkerKind.Analyse:
        return runAnalysis(request.file, reader, services, context.signal);
      case ToCodecWorkerKind.Decode:
        return runDecode(request.file, request.stream, reader, services, context);
      case ToCodecWorkerKind.Encode:
        return runEncode(
          request.encode,
          request.rendered,
          request.stream,
          this.#host.openExportEncoder,
          {
            codecModule: () => modules.codec.get(),
            encoderModule: (encoder) => modules.encoders[encoder].get(),
            encoding: this.#host.platform.encoding,
          },
          context,
        );
    }
  }
}
