/**
 * Reading a codec worker's message that crossed a thread, field by field
 * (REQ-EXEC-136.12): what the page and a connected client ask of the worker,
 * read by the worker before it acts, and what the worker answers, read by the
 * client before it shows or records anything. A file, a module and a port
 * are told by the members a reader uses, as the worker uses them; everything
 * else is rebuilt from its fields.
 */

import { metadataMapOf } from '@audiogubbins/codecs';
import {
  Malformed,
  boundedItemsOf,
  countAt,
  domainFailureAt,
  fieldsAt,
  fieldsOf,
  isTagged,
  layoutOf,
  rateOf,
  readMessage,
  sampleCountAt,
  sampleCountOf,
  textAt,
  textOf,
  type DomainResult,
  type MessageFields,
} from '@audiogubbins/domain';

import type { FileHandleLike, FileSource } from '../files/file-source.js';
import type { BlobLike } from '../files/sync-file-bytes.js';
import { isMessagePortLike, type MessagePortLike } from '../streams/stream-port.js';
import {
  codecEnvironmentOf,
  codecOf,
  containerOf,
  decoderIdentityOf,
  readableContainerOf,
} from './codec-values-reading.js';
import {
  FromCodecWorkerKind,
  ToCodecWorkerKind,
  type AnalysedStream,
  type CodecRequest,
  type FromCodecWorker,
  type ImportAnalysis,
  type MetadataOutcome,
  type ModuleSource,
  type PrebuiltEncoder,
  type ToCodecWorker,
} from './codec-worker-messages.js';
import { exportEncodeRequestOf } from './encode-request-reading.js';

/** The code a malformed message to or from the worker is refused with. */
const MALFORMED = 'codec-runtime.message-malformed';

/** The longest name a client gives a request. */
const MAXIMUM_REQUEST_CHARACTERS = 256;

/** The most codecs an analysis offers in place of the one it refused. */
const MOST_ALTERNATIVES = 32;

function requestAt(fields: MessageFields): string {
  const request = textAt(fields, 'request');
  if (request === '' || request.length > MAXIMUM_REQUEST_CHARACTERS) {
    throw new Malformed(
      'request',
      `a name of 1 to ${String(MAXIMUM_REQUEST_CHARACTERS)} characters`,
    );
  }
  return request;
}

function portAt(fields: MessageFields, field: string): MessagePortLike {
  const port = fields[field];
  if (!isMessagePortLike(port)) throw new Malformed(field, 'a message port');
  return port;
}

function isBlob(value: unknown): value is BlobLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'size') === 'number' &&
    typeof Reflect.get(value, 'slice') === 'function'
  );
}

function isFileHandle(value: unknown): value is FileHandleLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'createSyncAccessHandle') === 'function'
  );
}

function fileAt(fields: MessageFields): FileSource {
  const source = fieldsAt(fields, 'file');
  if (source['kind'] === 'file') {
    const file = source['file'];
    if (!isBlob(file)) throw new Malformed('file.file', 'a file');
    return { kind: 'file', file };
  }
  if (source['kind'] === 'origin-private') {
    const handle = source['handle'];
    if (!isFileHandle(handle)) throw new Malformed('file.handle', 'an origin-private file handle');
    return { kind: 'origin-private', handle };
  }
  throw new Malformed('file.kind', 'file or origin-private');
}

function moduleSourceOf(value: unknown, field: string): ModuleSource {
  const fields = fieldsOf(value, field);
  switch (fields['kind']) {
    case 'compiled': {
      const module = fields['module'];
      if (!(module instanceof WebAssembly.Module) || !isTagged(module, 'WebAssembly.Module')) {
        throw new Malformed(`${field}.module`, 'a compiled WebAssembly module');
      }
      return { kind: 'compiled', module };
    }
    case 'unavailable':
      return { kind: 'unavailable', reason: textOf(fields['reason'], `${field}.reason`) };
    default:
      throw new Malformed(`${field}.kind`, 'compiled or unavailable');
  }
}

function prebuiltEncodersAt(
  fields: MessageFields,
): Readonly<Record<PrebuiltEncoder, ModuleSource>> {
  const encoders = fieldsAt(fields, 'prebuiltEncoders');
  return {
    mp3: moduleSourceOf(encoders['mp3'], 'prebuiltEncoders.mp3'),
    vorbis: moduleSourceOf(encoders['vorbis'], 'prebuiltEncoders.vorbis'),
  };
}

/** A request, of the kinds every client may send. */
function requestOf(fields: MessageFields): CodecRequest {
  switch (fields['kind']) {
    case ToCodecWorkerKind.Analyse:
      return { kind: ToCodecWorkerKind.Analyse, request: requestAt(fields), file: fileAt(fields) };
    case ToCodecWorkerKind.Decode:
      return {
        kind: ToCodecWorkerKind.Decode,
        request: requestAt(fields),
        file: fileAt(fields),
        stream: portAt(fields, 'stream'),
      };
    case ToCodecWorkerKind.Encode:
      return {
        kind: ToCodecWorkerKind.Encode,
        request: requestAt(fields),
        encode: exportEncodeRequestOf(fields, 'encode'),
        rendered: portAt(fields, 'rendered'),
        stream: portAt(fields, 'stream'),
      };
    case ToCodecWorkerKind.Cancel:
      return { kind: ToCodecWorkerKind.Cancel, request: requestAt(fields) };
    default:
      throw new Malformed('kind', 'analyse, decode, encode or cancel');
  }
}

/** A message on the worker's own scope, from the page that started it. */
export function readToCodecWorker(value: unknown): DomainResult<ToCodecWorker> {
  return readMessage(value, MALFORMED, (fields): ToCodecWorker => {
    switch (fields['kind']) {
      case ToCodecWorkerKind.Configure:
        return {
          kind: ToCodecWorkerKind.Configure,
          codecModule: moduleSourceOf(fields['codecModule'], 'codecModule'),
          prebuiltEncoders: prebuiltEncodersAt(fields),
        };
      case ToCodecWorkerKind.Connect:
        return { kind: ToCodecWorkerKind.Connect, port: portAt(fields, 'port') };
      default:
        return requestOf(fields);
    }
  });
}

/** A message on a connected client's port, which only asks. */
export function readCodecRequest(value: unknown): DomainResult<CodecRequest> {
  return readMessage(value, MALFORMED, requestOf);
}

function streamOf(value: unknown, field: string): AnalysedStream {
  const fields = fieldsOf(value, field);
  const optionalCount = (name: string): number | undefined =>
    fields[name] === undefined ? undefined : countAt(fields, name);
  return {
    codec: codecOf(fields['codec'], `${field}.codec`),
    container: containerOf(fields['container'], `${field}.container`),
    sampleRate: rateOf(fields['sampleRate'], `${field}.sampleRate`),
    layout: layoutOf(fields['layout'], `${field}.layout`),
    statedFrames:
      fields['statedFrames'] === undefined
        ? undefined
        : sampleCountOf(fields['statedFrames'], `${field}.statedFrames`),
    leadingFrames: sampleCountOf(fields['leadingFrames'], `${field}.leadingFrames`),
    bitRate: optionalCount('bitRate'),
    bitsPerSample: optionalCount('bitsPerSample'),
  };
}

function metadataOutcomeOf(value: unknown, field: string): MetadataOutcome {
  const fields = fieldsOf(value, field);
  switch (fields['kind']) {
    case 'read':
      return { kind: 'read', metadata: metadataMapOf(fields['metadata'], `${field}.metadata`) };
    case 'none':
      return { kind: 'none' };
    case 'unread':
      return { kind: 'unread', failure: domainFailureAt(fields, 'failure') };
    default:
      throw new Malformed(`${field}.kind`, 'read, none or unread');
  }
}

function analysisOf(value: unknown, field: string): ImportAnalysis {
  const fields = fieldsOf(value, field);
  switch (fields['kind']) {
    case 'read-in-place':
      return {
        kind: 'read-in-place',
        container: readableContainerOf(fields['container'], `${field}.container`),
        codec: codecOf(fields['codec'], `${field}.codec`),
        metadata: metadataOutcomeOf(fields['metadata'], `${field}.metadata`),
      };
    case 'decode':
      return {
        kind: 'decode',
        stream: streamOf(fields['stream'], `${field}.stream`),
        decoder: decoderIdentityOf(fields['decoder'], `${field}.decoder`),
        metadata: metadataOutcomeOf(fields['metadata'], `${field}.metadata`),
      };
    case 'refused':
      return {
        kind: 'refused',
        failure: domainFailureAt(fields, 'failure'),
        alternatives: boundedItemsOf(
          fields['alternatives'],
          `${field}.alternatives`,
          MOST_ALTERNATIVES,
          codecOf,
        ),
      };
    default:
      throw new Malformed(`${field}.kind`, 'read-in-place, decode or refused');
  }
}

/** A message the worker sends, read by the page or a connected client. */
export function readFromCodecWorker(value: unknown): DomainResult<FromCodecWorker> {
  return readMessage(value, MALFORMED, (fields): FromCodecWorker => {
    switch (fields['kind']) {
      case FromCodecWorkerKind.Environment:
        return {
          kind: FromCodecWorkerKind.Environment,
          environment: codecEnvironmentOf(fields['environment'], 'environment'),
        };
      case FromCodecWorkerKind.Analysed:
        return {
          kind: FromCodecWorkerKind.Analysed,
          request: requestAt(fields),
          analysis: analysisOf(fields['analysis'], 'analysis'),
        };
      case FromCodecWorkerKind.Progress:
        return {
          kind: FromCodecWorkerKind.Progress,
          request: requestAt(fields),
          frames: countAt(fields, 'frames'),
        };
      case FromCodecWorkerKind.Decoded:
        return {
          kind: FromCodecWorkerKind.Decoded,
          request: requestAt(fields),
          frames: sampleCountAt(fields, 'frames'),
          decoder: decoderIdentityOf(fields['decoder'], 'decoder'),
        };
      case FromCodecWorkerKind.Encoded:
        return {
          kind: FromCodecWorkerKind.Encoded,
          request: requestAt(fields),
          frames: sampleCountAt(fields, 'frames'),
        };
      case FromCodecWorkerKind.Failed:
        return {
          kind: FromCodecWorkerKind.Failed,
          request: requestAt(fields),
          failure: domainFailureAt(fields, 'failure'),
        };
      case FromCodecWorkerKind.Cancelled:
        return { kind: FromCodecWorkerKind.Cancelled, request: requestAt(fields) };
      case FromCodecWorkerKind.Refused:
        return { kind: FromCodecWorkerKind.Refused, failure: domainFailureAt(fields, 'failure') };
      default:
        throw new Malformed(
          'kind',
          'environment, analysed, progress, decoded, encoded, failed, cancelled or refused',
        );
    }
  });
}
