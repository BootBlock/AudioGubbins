/**
 * A file opened for import in the codec worker (ADR-0090): recognised from
 * its contents, routed by the registry, and, where it is decoded, opened in
 * the codec module and described, its decoder named and its capability here
 * checked, all before anything is stored.
 *
 * A file read in place needs nothing more of the codec worker. One decoded
 * needs the codec module, loaded on first use; a stream the module describes
 * but does not decode, HE-AAC, needs the browser's decoder, probed. Where
 * what a file needs is unavailable it is refused with the capability's reason
 * and the codecs that serve instead (ADR-0091). Metadata is read through the
 * container's reader, and a reader's refusal is said rather than taken for
 * the file's: a file whose tags are broken still has audio.
 */

import {
  METADATA_READERS,
  adtsAudioConfig,
  codecCapability,
  importRoute,
  recogniseAudio,
  type AudioBytes,
  type CodecEnvironment,
  type CodecId,
  type ContainerId,
  type DecoderIdentity,
  type ReadableContainer,
  type SyncAudioBytes,
} from '@audiogubbins/codecs';
import type { CodecPlatform } from '@audiogubbins/capabilities';
import {
  FailureKind,
  failure,
  fail,
  sampleCount,
  sampleRate,
  succeed,
  type CancellationSignal,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';

import type { CodecModule } from '../codec-module.js';
import type { DecoderSession } from '../decoder-session.js';
import { browserAacBlocks } from '../decoding/browser-aac-blocks.js';
import { moduleDecodedBlocks, type DecodedBlocks } from '../decoding/decoded-blocks.js';
import { browserDecoder, isModuleDecoded, moduleDecoder } from '../decoding/decoder-identity.js';
import { streamLayout } from '../decoding/stream-layout.js';
import type { AnalysedStream, MetadataOutcome } from './codec-worker-messages.js';

/** What opening a file for import needs of the worker. */
export interface ImportServices {
  /** The codec module, loaded on the first call. */
  readonly codecModule: () => Promise<DomainResult<CodecModule>>;
  /** What the worker can do with each codec now. */
  readonly environment: () => CodecEnvironment;
  readonly platform: CodecPlatform;
}

/** A stream opened for decoding: its session, as analysis describes it, and its decoder. */
export interface OpenedStream {
  readonly session: DecoderSession;
  readonly stream: AnalysedStream;
  readonly decoder: DecoderIdentity;
}

/** A file opened for import. A decoded stream's session is the caller's to release. */
export type OpenedImport =
  | {
      readonly kind: 'read-in-place';
      readonly container: ReadableContainer;
      readonly codec: CodecId;
    }
  | { readonly kind: 'decode'; readonly opened: OpenedStream }
  | {
      readonly kind: 'refused';
      readonly failure: DomainFailure;
      readonly alternatives: readonly CodecId[];
    };

function refused(reason: DomainFailure, alternatives: readonly CodecId[] = []): OpenedImport {
  return { kind: 'refused', failure: reason, alternatives };
}

/** The refusal of a codec this worker cannot serve, or `undefined` where it can. */
function unavailable(environment: CodecEnvironment, codec: CodecId): OpenedImport | undefined {
  const capability = codecCapability(environment, codec, 'read');
  if (capability.kind === 'available') return undefined;
  return refused(
    failure('codec-runtime.codec-unavailable', FailureKind.Rejected, capability.reason, {
      details: { codec },
    }),
    capability.alternatives,
  );
}

/** The stream the module describes, as analysis records it, or why the domain cannot hold it. */
function analysedStream(session: DecoderSession): DomainResult<AnalysedStream> {
  const { description } = session;
  const layout = streamLayout(description);
  if (!layout.ok) return layout;
  const rate = sampleRate(description.sampleRate);
  if (!rate.ok) return rate;
  const leading = sampleCount(description.priming ?? 0);
  if (!leading.ok) return leading;
  let statedFrames: AnalysedStream['statedFrames'];
  if (description.totalFrames !== undefined) {
    const stated = sampleCount(description.totalFrames);
    if (!stated.ok) return stated;
    statedFrames = stated.value;
  }
  return succeed({
    codec: description.codec,
    container: description.container,
    sampleRate: rate.value,
    layout: layout.value,
    statedFrames,
    leadingFrames: leading.value,
    bitRate: description.bitRate,
    bitsPerSample: description.bitsPerSample,
  });
}

/**
 * Opens `file`, whose bytes `bytes` reads, for import: read in place, opened
 * for decoding, or refused. Reading the file may reject with the signal's
 * reason, or with `SourceUnreadable` where a read throws.
 */
export async function openImport(
  file: SyncAudioBytes,
  bytes: AudioBytes,
  services: ImportServices,
  signal: CancellationSignal,
): Promise<OpenedImport> {
  const recognised = await recogniseAudio(bytes, signal);
  if (!recognised.ok) return refused(recognised.failures[0]);
  const route = importRoute(recognised.value);
  if (route.kind === 'refuse') return refused(route.failure);
  if (route.kind === 'read-in-place') return route;

  const loaded = await services.codecModule();
  if (!loaded.ok) {
    // The load's failure has made the module's codecs unavailable here, which
    // the capability says with the codecs that serve instead.
    const stated =
      route.codec === undefined ? undefined : unavailable(services.environment(), route.codec);
    return stated ?? refused(loaded.failures[0]);
  }
  const session = loaded.value.openDecoder(file);
  if (!session.ok) return refused(session.failures[0]);
  const { codec } = session.value.description;
  const refusal = unavailable(services.environment(), codec);
  if (refusal !== undefined) {
    session.value.release();
    return refusal;
  }
  const stream = analysedStream(session.value);
  if (!stream.ok) {
    session.value.release();
    return refused(stream.failures[0]);
  }
  const decoder = isModuleDecoded(codec)
    ? moduleDecoder(codec)
    : browserDecoder(services.platform.browser);
  return { kind: 'decode', opened: { session: session.value, stream: stream.value, decoder } };
}

/** The failure of a codec no decoder here serves, which the registry should have refused. */
function missingDecoder(codec: CodecId): DomainFailure {
  return failure(
    'codec-runtime.codec-unavailable',
    FailureKind.Rejected,
    `No decoder here decodes ${codec}.`,
    { details: { codec } },
  );
}

/**
 * The blocks of an opened stream, decoded by the module where it decodes the
 * codec and by the browser's decoder of HE-AAC otherwise, configured by the
 * container's `AudioSpecificConfig`, or an ADTS stream's first header's. The
 * blocks made release the session; where none are made it is the caller's.
 */
export async function decodedBlocksOf(
  opened: OpenedStream,
  bytes: AudioBytes,
  platform: CodecPlatform,
  signal: CancellationSignal,
): Promise<DomainResult<DecodedBlocks>> {
  const { session } = opened;
  const { description } = session;
  if (description.decodable) return succeed(moduleDecodedBlocks(session));
  const decoding = platform.decoding;
  if (description.codec !== 'he-aac' || decoding === undefined) {
    return fail(missingDecoder(description.codec));
  }
  let config = description.codecConfig;
  if (config.length === 0 && description.container === 'adts') {
    const read = await adtsAudioConfig(bytes, signal);
    if (!read.ok) return read;
    config = read.value;
  }
  return browserAacBlocks(session, config, decoding);
}

/** The metadata of a file of `container`, read by its reader where it has one. */
export async function readMetadata(
  container: ContainerId,
  bytes: AudioBytes,
  signal: CancellationSignal,
): Promise<MetadataOutcome> {
  const reader = METADATA_READERS.get(container);
  if (reader === undefined) return { kind: 'none' };
  const read = await reader(bytes, signal);
  return read.ok
    ? { kind: 'read', metadata: read.value }
    : { kind: 'unread', failure: read.failures[0] };
}
