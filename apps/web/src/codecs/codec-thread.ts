/**
 * The page's codecs (ADR-0090): the codec worker, started on the first call
 * that needs it, with every module the page bundles compiled and handed to it,
 * and joined to the storage worker, so imports decode through it.
 *
 * Each module is a chunk of the bundle that is loaded and compiled only when
 * the worker is first needed, and the three are loaded and compiled together
 * while the worker starts. A module that cannot be had, one this copy was not
 * built with, a chunk that would not load or bytes that would not compile, is
 * handed to the worker as unavailable, with why: its formats are then
 * unavailable here and say so, and every other format works. The reason is
 * logged where the person's diagnostics can show it.
 *
 * The worker is configured before it is joined to storage, since it refuses
 * every request before it is configured, and the storage worker sends its
 * first request as soon as it is joined.
 */

import type { CodecCapability, CodecEnvironment, CodecId, CodecUse } from '@audiogubbins/codecs';
import type {
  ExportEncodeRequest,
  ImportAnalysis,
  ModuleSource,
} from '@audiogubbins/codec-runtime';
import type { Logger } from '@audiogubbins/diagnostics';
import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';

import type { Observable } from '../state/observable.js';
import { CodecClient, type CodecWorkerPort } from './codec-client.js';
import { createCodecEnvironmentStore, type CodecEnvironmentStore } from './codec-environment.js';
import type { CodecServices, EncodedFile } from './codec-services.js';

/** A module's bytes, as the bundle carries them, or why this copy carries none. */
export type BundledModule =
  | { readonly kind: 'bundled'; readonly bytes: Uint8Array<ArrayBuffer> }
  | { readonly kind: 'absent'; readonly reason: string };

/** Each module the page bundles, loaded when asked for. */
export interface BundledModules {
  readonly codec: () => Promise<BundledModule>;
  readonly mp3: () => Promise<BundledModule>;
  readonly vorbis: () => Promise<BundledModule>;
}

/** What the codecs are made with: the parts of the browser they use, given rather than reached for. */
export interface CodecThreadParts {
  /** Whether this page compiles WebAssembly, as its capabilities found. */
  readonly webAssembly: boolean;
  /** Starts the codec worker, under the page's policy. */
  readonly startWorker: () => CodecWorkerPort;
  readonly modules: BundledModules;
  readonly compile: (bytes: Uint8Array<ArrayBuffer>) => Promise<WebAssembly.Module>;
  /**
   * Joins the codec worker to the storage worker by the port given, or
   * `undefined` where this browser keeps no projects, and so has no storage
   * worker to join.
   */
  readonly join: ((port: MessagePort) => Promise<void>) | undefined;
  readonly logger: Logger;
}

/** What each module is called in a sentence. */
const MODULE_NAMES = {
  codec: 'codec module',
  mp3: 'MP3 encoder',
  vorbis: 'Vorbis encoder',
} as const satisfies Record<keyof BundledModules, string>;

function unstarted(reason: string): DomainFailure {
  return failure(
    'codecs.worker-unstarted',
    FailureKind.Unrecoverable,
    `The codec worker could not be started, so no compressed file can be imported or exported here: ${reason}`,
  );
}

function unjoined(reason: string): DomainFailure {
  return failure(
    'codecs.storage-unjoined',
    FailureKind.Unrecoverable,
    `The codec worker could not be joined to project storage, so no compressed file can be imported here: ${reason}`,
  );
}

/** The message of a thrown error, for a reason. */
function messageOf(error: Error): string {
  return error.message === '' ? error.name : error.message;
}

/** The page's codecs, over the codec worker it starts on first use. */
export class CodecThread implements CodecServices {
  readonly #parts: CodecThreadParts;
  readonly #environment: CodecEnvironmentStore;
  #started: Promise<DomainResult<CodecClient>> | undefined;

  constructor(parts: CodecThreadParts) {
    this.#parts = parts;
    this.#environment = createCodecEnvironmentStore(parts.webAssembly);
  }

  get environment(): Observable<CodecEnvironment> {
    return this.#environment;
  }

  capability(codec: CodecId, use: CodecUse): CodecCapability {
    return this.#environment.capability(codec, use);
  }

  async ready(): Promise<DomainResult<void>> {
    const started = await this.#client();
    return started.ok ? succeed(undefined) : started;
  }

  async analyse(file: Blob, signal: AbortSignal): Promise<DomainResult<ImportAnalysis>> {
    const started = await this.#client();
    return started.ok ? await started.value.analyse(file, signal) : started;
  }

  async encode(
    request: ExportEncodeRequest,
    ports: { readonly rendered: MessagePort; readonly stream: MessagePort },
    progress: (frames: number) => void,
    signal: AbortSignal,
  ): Promise<DomainResult<EncodedFile>> {
    const started = await this.#client();
    return started.ok ? await started.value.encode(request, ports, progress, signal) : started;
  }

  /** Stops the worker, where it was started; every request still waiting fails. */
  dispose(): void {
    void this.#started?.then((started) => {
      if (started.ok) started.value.terminate('The page closed the codec worker.');
    });
  }

  /** The client of the worker, started on the first call and answered to every later one. */
  #client(): Promise<DomainResult<CodecClient>> {
    this.#started ??= this.#start();
    return this.#started;
  }

  async #start(): Promise<DomainResult<CodecClient>> {
    const { modules, logger } = this.#parts;
    // Three, so loaded and compiled together, while the worker starts.
    const sources = Promise.all([
      this.#source('codec', modules.codec),
      this.#source('mp3', modules.mp3),
      this.#source('vorbis', modules.vorbis),
    ]);
    let port: CodecWorkerPort;
    try {
      port = this.#parts.startWorker();
    } catch (error) {
      // A browser refuses to make a worker of a script it may not run, by a DOMException.
      if (!(error instanceof DOMException)) throw error;
      return fail(unstarted(messageOf(error)));
    }
    const client = new CodecClient(port, {
      environment: (environment) => {
        this.#environment.adopt(environment);
      },
      refused: (refusal) => {
        logger.error('The codec worker could not read a message the page sent it.', {
          code: refusal.code,
          reason: refusal.summary,
        });
      },
    });
    const [codecModule, mp3, vorbis] = await sources;
    client.configure(codecModule, { mp3, vorbis });
    const started = await client.started();
    if (!started.ok) {
      client.terminate(started.failures[0].summary);
      return fail(unstarted(started.failures[0].summary));
    }
    const joined = await this.#join(client);
    if (!joined.ok) {
      client.terminate(joined.failures[0].summary);
      return joined;
    }
    return succeed(client);
  }

  /** Joins the worker to the storage worker, where there is one. */
  async #join(client: CodecClient): Promise<DomainResult<void>> {
    const { join } = this.#parts;
    if (join === undefined) return succeed(undefined);
    const channel = new MessageChannel();
    client.connect(channel.port1);
    try {
      await join(channel.port2);
    } catch (error) {
      // The storage worker's client rejects a call it could not make with an Error.
      if (!(error instanceof Error)) throw error;
      return fail(unjoined(messageOf(error)));
    }
    return succeed(undefined);
  }

  /** The module `load` gives, compiled, or why there is none. */
  async #source(
    module: keyof BundledModules,
    load: () => Promise<BundledModule>,
  ): Promise<ModuleSource> {
    const unavailable = (reason: string): ModuleSource => {
      this.#parts.logger.warning(`The ${MODULE_NAMES[module]} could not be loaded.`, { reason });
      return { kind: 'unavailable', reason };
    };
    try {
      const bundled = await load();
      if (bundled.kind === 'absent') return unavailable(bundled.reason);
      return { kind: 'compiled', module: await this.#parts.compile(bundled.bytes) };
    } catch (error) {
      // A chunk that would not load rejects with a TypeError, and bytes that
      // would not compile, or a policy that forbids compiling, with a
      // CompileError: each an Error, and each the module's alone.
      if (!(error instanceof Error)) throw error;
      return unavailable(messageOf(error));
    }
  }
}
