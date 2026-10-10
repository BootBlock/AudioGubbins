/**
 * The storage worker's link to the codec worker (ADR-0090): the port the page
 * joined the two by, over which the storage worker asks the codec worker to
 * analyse a file and to decode one into a stream of its own.
 *
 * Each request is named by the storage worker and answered once on the link,
 * read field by field (`readFromCodecWorker`); a request called off is
 * cancelled there too. A decode's blocks travel over a channel the storage
 * worker makes for it and reads with credit (`credited-stream-port.ts`), so no
 * sample passes through the page; where the codec worker ends a decode on the
 * link alone, before or while its stream runs, the stream is ended with the
 * same failure, so a reader never waits on a stream that will not come. A file
 * the codec worker cannot read, one the page reads for the worker, and any file
 * where the page joined no codec worker, is refused as not decodable here.
 */

import {
  readFromCodecWorker,
  type FileSource,
  type FromCodecWorker,
  type ImportAnalysis,
  type MetadataOutcome,
} from '@audiogubbins/codec-runtime';
import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';
import type { DecodedStreamMessage } from '@audiogubbins/import-export';
import {
  decodingUnavailable,
  type FileDecoding,
  type FileMetadata,
  type StreamAnalysis,
} from '@audiogubbins/storage';

import type { CrossingBytes } from '../protocol/page-operations.js';
import { portDecodedStream, type CreditedStream } from './credited-stream-port.js';

/** What a request waits for: its analysis, or the end of its decode. */
type Pending =
  | { readonly kind: 'analyse'; readonly answer: (analysis: DomainResult<ImportAnalysis>) => void }
  | { readonly kind: 'decode'; readonly stream: CreditedStream<DecodedStreamMessage> };

/** A cancelled request, as the codec worker's answer ends it. */
const CANCELLED = failure('import.cancelled', FailureKind.Conflict, 'The import was cancelled.');

/** An analysis of a file the storage routed to a decode that says it is read in place. */
const DISAGREES = failure(
  'import.analysis-disagrees',
  FailureKind.IntegrityViolation,
  'The codec worker found the file to be read where it lies, which its storage routed to a decode.',
);

/** The storage worker's link to the codec worker (see the module comment). */
export class CodecWorkerLink {
  readonly #pending = new Map<string, Pending>();
  #port: MessagePort | undefined;
  #requests = 0;

  /** Joins the link to the codec worker over `port`, in place of any before. */
  connect(port: MessagePort): void {
    this.#port?.close();
    this.#port = port;
    port.addEventListener('message', (event) => {
      const read = readFromCodecWorker(event.data);
      if (read.ok) this.#answered(read.value);
    });
    port.start();
  }

  /** A file's decoding, its bytes as they crossed from the page. */
  decoding(bytes: CrossingBytes): FileDecoding {
    const file: FileSource | undefined =
      bytes.kind === 'file' ? { kind: 'file', file: bytes.file } : undefined;
    return {
      analyse: async (signal) => {
        const port = this.#port;
        if (port === undefined || file === undefined) return fail(decodingUnavailable());
        const analysis = await new Promise<DomainResult<ImportAnalysis>>((answer) => {
          const request = this.#request({ kind: 'analyse', answer }, signal);
          port.postMessage({ kind: 'analyse', request, file });
        });
        return analysisOf(analysis);
      },
      decode: (signal) => {
        const port = this.#port;
        if (port === undefined || file === undefined) {
          return Promise.resolve(fail(decodingUnavailable()));
        }
        const channel = new MessageChannel();
        const stream = portDecodedStream(channel.port1);
        const request = this.#request({ kind: 'decode', stream }, signal);
        port.postMessage({ kind: 'decode', request, file, stream: channel.port2 }, [channel.port2]);
        return Promise.resolve(succeed(stream));
      },
    };
  }

  /** Names a request, cancelled on the link where `signal` aborts. */
  #request(pending: Pending, signal: AbortSignal | undefined): string {
    this.#requests += 1;
    const request = `storage-${String(this.#requests)}`;
    this.#pending.set(request, pending);
    signal?.addEventListener(
      'abort',
      () => {
        if (this.#pending.has(request)) this.#port?.postMessage({ kind: 'cancel', request });
      },
      { once: true },
    );
    return request;
  }

  #answered(message: FromCodecWorker): void {
    if (!('request' in message)) return;
    const pending = this.#pending.get(message.request);
    if (pending === undefined) return;
    switch (message.kind) {
      case 'progress':
        return;
      case 'analysed':
        this.#settle(message.request, pending, succeed(message.analysis));
        return;
      case 'failed':
        this.#settle(message.request, pending, fail(message.failure));
        return;
      case 'cancelled':
        this.#settle(message.request, pending, fail(CANCELLED));
        return;
      default:
        this.#pending.delete(message.request);
    }
  }

  /** Ends a request with how it ended: an analysis answered, or a decode's stream ended. */
  #settle(request: string, pending: Pending, ended: DomainResult<ImportAnalysis>): void {
    this.#pending.delete(request);
    if (pending.kind === 'analyse') {
      pending.answer(ended);
      return;
    }
    // A decode ended on the link ends its stream, which may never have begun.
    if (!ended.ok) pending.stream.end({ kind: 'failed', failure: ended.failures[0] });
  }
}

/** What the storage takes of an analysis, or why the file is refused. */
function analysisOf(answer: DomainResult<ImportAnalysis>): DomainResult<StreamAnalysis> {
  if (!answer.ok) return answer;
  const analysis = answer.value;
  switch (analysis.kind) {
    case 'refused':
      return fail(analysis.failure);
    case 'read-in-place':
      return fail(DISAGREES);
    case 'decode': {
      const { stream, decoder } = analysis;
      return succeed({
        container: stream.container,
        codec: stream.codec,
        sampleRate: stream.sampleRate,
        layout: stream.layout,
        statedFrames: stream.statedFrames,
        leadingFrames: stream.leadingFrames,
        bitRate: stream.bitRate,
        decoder,
        metadata: metadataOf(analysis.metadata),
      });
    }
  }
}

/** A file's metadata as the storage keeps it: none mapped is an empty map. */
function metadataOf(outcome: MetadataOutcome): FileMetadata {
  switch (outcome.kind) {
    case 'read':
      return { kind: 'read', metadata: outcome.metadata };
    case 'none':
      return { kind: 'read', metadata: {} };
    case 'unread':
      return { kind: 'refused', failure: outcome.failure };
  }
}
