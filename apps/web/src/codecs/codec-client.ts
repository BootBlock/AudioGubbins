/**
 * The page's side of the codec worker's protocol (ADR-0090, ADR-0092): each
 * request named by an identity of its own and answered once, every answer
 * read field by field before it is believed (REQ-EXEC-136.12), and a request
 * whose signal aborts cancelled in the worker, so it keeps nothing.
 *
 * The worker says what it can do with the codecs once it has probed the browser
 * and been configured, and whenever a module's load changes it; the first such
 * word is also the sign it runs at all. A fault of the worker, its script
 * failing to load or an answer that cannot be read, fails every request it was
 * serving, since any of them may have lost its answer, and cancels each in the
 * worker, so none goes on behind a page that has stopped waiting.
 */

import type { CodecEnvironment } from '@audiogubbins/codecs';
import {
  FromCodecWorkerKind,
  ToCodecWorkerKind,
  WORK_CANCELLED,
  readFromCodecWorker,
  type ExportEncodeRequest,
  type FromCodecWorker,
  type ImportAnalysis,
  type ModuleSource,
  type EncoderModuleName,
  type ToCodecWorker,
} from '@audiogubbins/codec-runtime';
import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';

import type { EncodedFile } from './codec-services.js';

/** The codec worker, as the page talks to it. */
export interface CodecWorkerPort {
  post(message: ToCodecWorker, transfer: readonly Transferable[]): void;
  /**
   * Hears each message the worker sends, and each fault: an error the worker
   * raised, its script among them, or a message that could not be read.
   */
  listen(onMessage: (data: unknown) => void, onFault: (reason: string) => void): void;
  terminate(): void;
}

/** What the client tells its owner of, apart from the answers to requests. */
export interface CodecClientEvents {
  /** What the worker can do with the codecs now. */
  readonly environment: (environment: CodecEnvironment) => void;
  /**
   * A message the worker could not read, which names no request: a defect of
   * the page's, since every message it sends is of the protocol.
   */
  readonly refused: (failure: DomainFailure) => void;
}

/** The answers that end a request, of the kinds its request may be answered with. */
type Answer = Extract<
  FromCodecWorker,
  { readonly kind: 'analysed' | 'decoded' | 'encoded' | 'failed' | 'cancelled' }
>;

/** A request waiting for its answer. */
interface Pending {
  readonly answer: (message: Answer) => void;
  readonly progress: (frames: number) => void;
  readonly fail: (reason: DomainFailure) => void;
}

/** The failure of a request the worker answered with an answer of another kind. */
function answeredOtherwise(kind: string): DomainFailure {
  return failure(
    'codecs.answer-unexpected',
    FailureKind.IntegrityViolation,
    `The codec worker answered with "${kind}", which does not answer what was asked.`,
  );
}

/** The failure of every request a fault of the worker ends. */
function faulted(reason: string): DomainFailure {
  return failure('codecs.worker-fault', FailureKind.Unrecoverable, reason);
}

/** The codec worker's requests and answers, over `port`. */
export class CodecClient {
  readonly #port: CodecWorkerPort;
  readonly #events: CodecClientEvents;
  readonly #pending = new Map<string, Pending>();
  readonly #started: Promise<DomainResult<void>>;
  #start: (result: DomainResult<void>) => void = () => undefined;
  #requests = 0;

  constructor(port: CodecWorkerPort, events: CodecClientEvents) {
    this.#port = port;
    this.#events = events;
    this.#started = new Promise((resolve) => {
      this.#start = resolve;
    });
    port.listen(
      (data) => {
        this.#receive(data);
      },
      (reason) => {
        this.#fault(reason);
      },
    );
  }

  /**
   * Resolves once the worker has said what it can do, the sign it runs; or
   * fails where it met a fault first, such as a script that would not load.
   */
  started(): Promise<DomainResult<void>> {
    return this.#started;
  }

  /** Gives the worker its modules, once, before any request. */
  configure(
    codecModule: ModuleSource,
    encoderModules: Readonly<Record<EncoderModuleName, ModuleSource>>,
  ): void {
    this.#port.post({ kind: ToCodecWorkerKind.Configure, codecModule, encoderModules }, []);
  }

  /** Has the worker serve another context's requests over `port`, such as the storage worker's. */
  connect(port: MessagePort): void {
    this.#port.post({ kind: ToCodecWorkerKind.Connect, port }, [port]);
  }

  /** Analyses `file` in the worker (see `CodecServices.analyse`). */
  analyse(file: Blob, signal: AbortSignal): Promise<DomainResult<ImportAnalysis>> {
    return this.#ask(
      'analyse',
      (request) => ({ kind: ToCodecWorkerKind.Analyse, request, file: { kind: 'file', file } }),
      [],
      (answer) =>
        answer.kind === FromCodecWorkerKind.Analysed
          ? succeed(answer.analysis)
          : fail(answeredOtherwise(answer.kind)),
      () => undefined,
      signal,
    );
  }

  /** Encodes a rendered stream in the worker (see `CodecServices.encode`). */
  encode(
    encode: ExportEncodeRequest,
    ports: { readonly rendered: MessagePort; readonly stream: MessagePort },
    progress: (frames: number) => void,
    signal: AbortSignal,
  ): Promise<DomainResult<EncodedFile>> {
    return this.#ask(
      'encode',
      (request) => ({
        kind: ToCodecWorkerKind.Encode,
        request,
        encode,
        rendered: ports.rendered,
        stream: ports.stream,
      }),
      [ports.rendered, ports.stream],
      (answer) =>
        answer.kind === FromCodecWorkerKind.Encoded
          ? succeed({
              frames: answer.frames,
              encoder: { id: encode.target.codec, ...answer.encoder },
            })
          : fail(answeredOtherwise(answer.kind)),
      progress,
      signal,
    );
  }

  /** Stops the worker; every request still waiting fails with `reason`. */
  terminate(reason: string): void {
    this.#port.terminate();
    this.#failAll(faulted(reason));
  }

  /**
   * Sends the request `message` makes of its identity, and answers what
   * `done` makes of its answer, or its failure or cancellation.
   */
  #ask<T>(
    kind: string,
    message: (request: string) => ToCodecWorker,
    transfer: readonly Transferable[],
    done: (answer: Exclude<Answer, { readonly kind: 'failed' | 'cancelled' }>) => DomainResult<T>,
    progress: (frames: number) => void,
    signal: AbortSignal,
  ): Promise<DomainResult<T>> {
    if (signal.aborted) return Promise.resolve(fail(WORK_CANCELLED));
    this.#requests += 1;
    const request = `${kind}-${String(this.#requests)}`;
    return new Promise((resolve) => {
      const cancel = (): void => {
        if (!this.#pending.delete(request)) return;
        this.#port.post({ kind: ToCodecWorkerKind.Cancel, request }, []);
        resolve(fail(WORK_CANCELLED));
      };
      const settle = (result: DomainResult<T>): void => {
        signal.removeEventListener('abort', cancel);
        this.#pending.delete(request);
        resolve(result);
      };
      this.#pending.set(request, {
        answer: (answer) => {
          switch (answer.kind) {
            case FromCodecWorkerKind.Failed:
              settle(fail(answer.failure));
              return;
            case FromCodecWorkerKind.Cancelled:
              // Only the page cancels a request, and it has stopped waiting for
              // one it cancelled, so the worker cancelled this one itself.
              settle(fail(WORK_CANCELLED));
              return;
            default:
              settle(done(answer));
          }
        },
        progress,
        fail: (reason) => {
          settle(fail(reason));
        },
      });
      signal.addEventListener('abort', cancel, { once: true });
      this.#port.post(message(request), transfer);
    });
  }

  #receive(data: unknown): void {
    const read = readFromCodecWorker(data);
    if (!read.ok) {
      this.#fault(`An answer from the codec worker could not be read: ${read.failures[0].summary}`);
      return;
    }
    const message = read.value;
    switch (message.kind) {
      case FromCodecWorkerKind.Environment:
        this.#events.environment(message.environment);
        this.#start(succeed(undefined));
        return;
      case FromCodecWorkerKind.Refused:
        this.#events.refused(message.failure);
        return;
      case FromCodecWorkerKind.Progress:
        this.#pending.get(message.request)?.progress(message.frames);
        return;
      default:
        // An answer to a request no longer waited for, one cancelled, is let go.
        this.#pending.get(message.request)?.answer(message);
    }
  }

  #fault(reason: string): void {
    this.#start(fail(faulted(reason)));
    for (const request of this.#pending.keys()) {
      this.#port.post({ kind: ToCodecWorkerKind.Cancel, request }, []);
    }
    this.#failAll(faulted(reason));
  }

  #failAll(reason: DomainFailure): void {
    for (const pending of [...this.#pending.values()]) pending.fail(reason);
  }
}
