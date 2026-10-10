/**
 * The messages between the codec worker and the contexts that ask it for work
 * (ADR-0090, ADR-0091, ADR-0092).
 *
 * The page starts the worker and `configure`s it once with where the codec
 * module and the prebuilt encoders are, and may `connect` another context,
 * such as the storage worker, by a port of its own. Each client then sends
 * requests, each named by the client, over its channel: `analyse` a file,
 * `decode` one into a stream to the storage worker, or `encode` a rendered
 * stream into a file's bytes for the storage worker; and `cancel` any of
 * them. The worker answers each request once, as done, failed or cancelled,
 * with progress before; and tells the page what it can do with each codec
 * whenever that changes. No sample passes through a request's channel: the
 * streams travel over the ports a request carries.
 *
 * Each direction is one discriminated union, read field by field on arrival
 * (`codec-worker-message-reading.ts`).
 */

import type {
  CodecEnvironment,
  CodecId,
  ContainerId,
  MetadataMap,
  ReadableContainer,
} from '@audiogubbins/codecs';
import type { DecoderIdentity } from '@audiogubbins/codecs';
import type { ChannelLayout, DomainFailure, SampleCount, SampleRate } from '@audiogubbins/domain';
import type { DitherSettings, ExportTarget, FormatEncoding } from '@audiogubbins/import-export';

import type { EncoderIdentity } from '../encoding/encoder-identity.js';
import type { FileSource } from '../files/file-source.js';
import type { MessagePortLike } from '../streams/stream-port.js';

/**
 * A module the worker loads: compiled by the page from the bytes it bundles,
 * which a dedicated worker accepts as it is, as the DSP module reaches the
 * render worker; or why the page has none to give, which makes its formats
 * unavailable. The worker fetches nothing (REQ-PRIV-161).
 */
export type ModuleSource =
  | { readonly kind: 'compiled'; readonly module: WebAssembly.Module }
  | { readonly kind: 'unavailable'; readonly reason: string };

/** The prebuilt encoders, each a module of its own (ADR-0091). */
export type PrebuiltEncoder = 'mp3' | 'vorbis';

/**
 * What an export's encoder is opened with: the planned file's target and
 * encoding, the rate and layout its rendered blocks arrive at, the metadata
 * it carries (ADR-0093), and the dither before an integer encoder, its
 * settings and the generator's key (ADR-0092).
 */
export interface ExportEncodeRequest {
  readonly target: ExportTarget;
  readonly encoding: FormatEncoding;
  readonly sampleRate: SampleRate;
  readonly layout: ChannelLayout;
  readonly metadata: MetadataMap;
  readonly dither: { readonly settings: DitherSettings; readonly key: number };
}

/** The kinds of message the worker is sent. */
export const ToCodecWorkerKind = {
  Configure: 'configure',
  Connect: 'connect',
  Analyse: 'analyse',
  Decode: 'decode',
  Encode: 'encode',
  Cancel: 'cancel',
} as const;

/** A request a client sends over its channel. */
export type CodecRequest =
  | {
      /** Recognises a file, routes it, and describes its stream and metadata. */
      readonly kind: typeof ToCodecWorkerKind.Analyse;
      readonly request: string;
      readonly file: FileSource;
    }
  | {
      /** Decodes a file into a `DecodedStreamMessage` stream over `stream`. */
      readonly kind: typeof ToCodecWorkerKind.Decode;
      readonly request: string;
      readonly file: FileSource;
      readonly stream: MessagePortLike;
    }
  | {
      /**
       * Encodes the `RenderedStreamMessage` stream arriving over `rendered`
       * into an `EncodedStreamMessage` stream over `stream`.
       */
      readonly kind: typeof ToCodecWorkerKind.Encode;
      readonly request: string;
      readonly encode: ExportEncodeRequest;
      readonly rendered: MessagePortLike;
      readonly stream: MessagePortLike;
    }
  | {
      /** Cancels a request, queued or running. */
      readonly kind: typeof ToCodecWorkerKind.Cancel;
      readonly request: string;
    };

/** A message the worker is sent on its own scope, by the page that started it. */
export type ToCodecWorker =
  | {
      /** Says once where the modules are; no request is served before it. */
      readonly kind: typeof ToCodecWorkerKind.Configure;
      readonly codecModule: ModuleSource;
      readonly prebuiltEncoders: Readonly<Record<PrebuiltEncoder, ModuleSource>>;
    }
  | {
      /** Serves another client's requests over `port`, such as the storage worker's. */
      readonly kind: typeof ToCodecWorkerKind.Connect;
      readonly port: MessagePortLike;
    }
  | CodecRequest;

/** A decoded stream, as analysis found it: what an asset's provenance records of its source. */
export interface AnalysedStream {
  readonly codec: CodecId;
  readonly container: ContainerId;
  /** The stream's own rate, which the rendition keeps. */
  readonly sampleRate: SampleRate;
  /** The stream's channels, in the order they decode in. */
  readonly layout: ChannelLayout;
  /** The frames the stream states, priming and padding trimmed, where it states them. */
  readonly statedFrames: SampleCount | undefined;
  /** The file's frames before the first decoded, which its own positions count from. */
  readonly leadingFrames: SampleCount;
  /** The file's average bit rate, where it states one. */
  readonly bitRate: number | undefined;
  /** The bits of each sample of a lossless stream. */
  readonly bitsPerSample: number | undefined;
}

/** A file's metadata, as analysis read it. */
export type MetadataOutcome =
  | { readonly kind: 'read'; readonly metadata: MetadataMap }
  /** Its container maps no metadata (ADR-0093), as WebM and Matroska do not. */
  | { readonly kind: 'none' }
  /** It breaks its format's rules, so none of it is kept; the audio may still be. */
  | { readonly kind: 'unread'; readonly failure: DomainFailure };

/** How a file is imported, as analysis found it, before anything is stored. */
export type ImportAnalysis =
  | {
      readonly kind: 'read-in-place';
      readonly container: ReadableContainer;
      readonly codec: CodecId;
      readonly metadata: MetadataOutcome;
    }
  | {
      readonly kind: 'decode';
      readonly stream: AnalysedStream;
      readonly decoder: DecoderIdentity;
      readonly metadata: MetadataOutcome;
    }
  | {
      /** Refused, with the reason and the codecs that serve the same use here. */
      readonly kind: 'refused';
      readonly failure: DomainFailure;
      readonly alternatives: readonly CodecId[];
    };

/** The kinds of message the worker sends. */
export const FromCodecWorkerKind = {
  Environment: 'environment',
  Analysed: 'analysed',
  Progress: 'progress',
  Decoded: 'decoded',
  Encoded: 'encoded',
  Failed: 'failed',
  Cancelled: 'cancelled',
  Refused: 'refused',
} as const;

/** A message the worker sends. */
export type FromCodecWorker =
  | {
      /**
       * What the worker can do with each codec, sent once it is probed and
       * configured, and whenever a load changes it.
       */
      readonly kind: typeof FromCodecWorkerKind.Environment;
      readonly environment: CodecEnvironment;
    }
  | {
      readonly kind: typeof FromCodecWorkerKind.Analysed;
      readonly request: string;
      readonly analysis: ImportAnalysis;
    }
  | {
      /** The frames decoded or encoded so far. */
      readonly kind: typeof FromCodecWorkerKind.Progress;
      readonly request: string;
      readonly frames: number;
    }
  | {
      /** Every block was sent and taken; the stream's end was the last message. */
      readonly kind: typeof FromCodecWorkerKind.Decoded;
      readonly request: string;
      readonly frames: SampleCount;
      readonly decoder: DecoderIdentity;
    }
  | {
      /** The file's bytes were sent and taken; `finished` was the last message. */
      readonly kind: typeof FromCodecWorkerKind.Encoded;
      readonly request: string;
      readonly frames: SampleCount;
      /** The encoder that wrote them, which the export's record names. */
      readonly encoder: EncoderIdentity;
    }
  | {
      readonly kind: typeof FromCodecWorkerKind.Failed;
      readonly request: string;
      readonly failure: DomainFailure;
    }
  | { readonly kind: typeof FromCodecWorkerKind.Cancelled; readonly request: string }
  | {
      /** A message that could not be read, which names no request it could answer. */
      readonly kind: typeof FromCodecWorkerKind.Refused;
      readonly failure: DomainFailure;
    };
