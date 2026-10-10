/**
 * Bringing a compressed file into a project as a decoded rendition (ADR-0090,
 * REQ-ARCH-049, REQ-ARCH-085).
 *
 * The codec worker decodes; the storage only writes. The stream's description
 * comes first, read from the file's headers, and is checked and sized before
 * anything is stored: the file is refused where the storage has no room for
 * the file itself, where it is copied, and the rendition, whose size the
 * stream's stated length gives. The file is then kept as the person chose,
 * copied into the store or linked where it lies, and the stream's blocks are
 * written as they arrive (`rendition-receiving.ts`) and stored as a 32-bit
 * float WAV file as every file the storage makes itself is (`stored-wav.ts`),
 * at the stream's own rate, never resampled. The asset is the rendition: its
 * provenance names the file it was decoded from, its codec, the decoder and
 * its version, and how the file is kept, and the file's metadata, whose loops
 * and cues are placed on the asset in its frames.
 *
 * A stream refused, failed part way or cancelled keeps nothing: the codec
 * worker is told, the scratch file is removed, and every object stored is let
 * go, for collection to take.
 */

import type { CodecId, ContainerId } from '@audiogubbins/codecs';
import {
  AssetOrigin,
  fail,
  sampleRate,
  succeed,
  type Asset,
  type ChannelLayout,
  type DomainFailure,
  type DomainResult,
  type ProjectId,
  type SampleRate,
} from '@audiogubbins/domain';
import type { DecodedStreamDescription } from '@audiogubbins/import-export';
import type { ImportedMedia } from '@audiogubbins/media-store';
import {
  keptMetadata,
  storageKeyOf,
  type AssetSource,
  type DecodedRendition,
  type KeptCompressedSource,
} from '@audiogubbins/project-format';

import { keepFile, withFileMetadata } from './file-keeping.js';
import type {
  AudioImport,
  AudioImportServices,
  ImportObserver,
  PreparedImport,
} from './import-contracts.js';
import type { DecodedStream } from './decoded-stream.js';
import { checkRoom, keepsCopy, renditionBytes } from './import-analysis.js';
import {
  renditionReadBackDiffers,
  streamOutOfOrder,
  streamUndescribable,
} from './import-failures.js';
import { importPlacements } from './import-placements.js';
import { receiveRendition } from './rendition-receiving.js';
import { renditionScratchPath } from './staging-paths.js';
import { mediaSharingOf } from './storage-sharing.js';
import { STORED_WAV_MEDIA_TYPE, storeFloatWav, type StoredWav } from './stored-wav.js';

/** A file the analysis routed to a decode, ready to be decoded. */
export interface DecodedImport extends AudioImport {
  readonly displayName: string;
  readonly project: ProjectId;

  /** The container recognised and the codec it states, where it states one. */
  readonly route: { readonly container: ContainerId; readonly codec: CodecId | undefined };
}

/** A stream's description, checked as an asset's audio. */
interface Described {
  readonly description: DecodedStreamDescription;
  readonly sampleRate: SampleRate;
  readonly layout: ChannelLayout;
}

/**
 * Decodes `request.file` into a rendition and keeps the file as the person
 * chose, ready to be added (see the module comment). Rejects with the
 * signal's reason, having kept nothing, where the import is cancelled.
 */
export async function prepareDecoded(
  request: DecodedImport,
  services: AudioImportServices,
  observe: ImportObserver,
  signal?: AbortSignal,
): Promise<DomainResult<PreparedImport>> {
  const decoding = await request.decode(signal);
  if (!decoding.ok) return decoding;
  const stream = decoding.value;
  const described = await describedStream(stream, request.route.codec);
  if (!described.ok) return described;
  const sized = await sizedFor(request, described.value, services);
  if (!sized.ok) {
    stream.refuse(sized.failures[0]);
    return sized;
  }
  let kept: ImportedMedia | undefined;
  let stored: StoredWav | undefined;
  try {
    const keeping = await keepFile(request, request.project, services, observe, {}, signal);
    if (!keeping.ok) {
      stream.refuse(keeping.failures[0]);
      return keeping;
    }
    kept = keeping.value;
    const rendition = await decodedInto(
      stream,
      described.value,
      request,
      services,
      observe,
      signal,
    );
    if (!rendition.ok) return rendition;
    stored = rendition.value;
    return succeed(prepared(request, described.value, kept, stored, services));
  } finally {
    // What the import holds is let go here unless it is prepared, when the
    // change that refers to it lets it go once it is written.
    if (stored === undefined && kept?.held !== undefined) services.store.release(kept.held);
  }
}

/** The stream's description, read first and checked, or why the stream is refused. */
async function describedStream(
  stream: DecodedStream,
  stated: CodecId | undefined,
): Promise<DomainResult<Described>> {
  const first = await stream.next();
  if (first?.kind === 'failed') return fail(first.failure);
  if (first?.kind !== 'description') {
    return refused(stream, streamOutOfOrder('the stream did not begin with its description'));
  }
  const { description } = first;
  const rate = sampleRate(description.sampleRate);
  if (!rate.ok) return refused(stream, streamUndescribable(rate.failures[0]));
  if (description.layout.roles.length === 0) {
    return refused(stream, streamOutOfOrder('the stream was described with no channels'));
  }
  if (stated !== undefined && description.codec !== stated) {
    return refused(
      stream,
      streamOutOfOrder(`the file states ${stated} and the decoder read ${description.codec}`),
    );
  }
  return succeed({ description, sampleRate: rate.value, layout: description.layout });
}

/** Refuses the stream for `failure`, which the import fails with. */
function refused(stream: DecodedStream, failure: DomainFailure): DomainResult<never> {
  stream.refuse(failure);
  return fail(failure);
}

/**
 * Whether the storage has room for the file, where a copy of it is kept, and
 * the rendition, where the stream states its length (`import-analysis.ts`).
 */
async function sizedFor(
  request: DecodedImport,
  described: Described,
  services: AudioImportServices,
): Promise<DomainResult<void>> {
  const { sampleRate: rate, layout, description } = described;
  const rendition = renditionBytes({ sampleRate: rate, layout }, description.statedFrames);
  if (!rendition.ok) return rendition;
  const file = keepsCopy(request.choice) ? request.file.source.size : 0;
  return await checkRoom(file + (rendition.value ?? 0), services.room);
}

/**
 * The stream's blocks written and stored as the rendition, sharing the
 * storage-wide lock while its scratch file is written, so no window starting
 * removes it as left over.
 */
async function decodedInto(
  stream: DecodedStream,
  described: Described,
  request: DecodedImport,
  services: AudioImportServices,
  observe: ImportObserver,
  signal?: AbortSignal,
): Promise<DomainResult<StoredWav>> {
  observe({ kind: 'decode', framesTotal: described.description.statedFrames });
  const release = await mediaSharingOf(services.coordinator).share(signal);
  try {
    const scratch = {
      tree: services.tree,
      path: renditionScratchPath(request.project, services.nextToken()),
    };
    const received = await receiveRendition(
      stream,
      described.layout,
      scratch,
      (framesDecoded) => {
        observe({ kind: 'decode-progress', framesDecoded });
      },
      signal,
    );
    if (!received.ok) return received;
    try {
      return await storeFloatWav(
        received.value.data,
        { sampleRate: described.sampleRate, layout: described.layout },
        received.value.frames,
        services,
        renditionReadBackDiffers,
        signal,
      );
    } finally {
      await received.value.discard();
    }
  } finally {
    release();
  }
}

/** The import prepared: the asset is the rendition, decoded from the file kept as chosen. */
function prepared(
  request: DecodedImport,
  described: Described,
  kept: ImportedMedia,
  stored: StoredWav,
  services: AudioImportServices,
): PreparedImport {
  const { description } = described;
  const { contentId, byteLength } = stored.identity;
  const media = {
    kind: 'managed',
    contentId,
    byteLength,
    mediaType: STORED_WAV_MEDIA_TYPE,
  } as const;
  const frames = stored.format.frames;
  const rendition: DecodedRendition = {
    container: request.route.container,
    codec: description.codec,
    sampleRate: described.sampleRate,
    layout: described.layout,
    frames,
    ...(description.statedFrames === undefined ? {} : { statedFrames: description.statedFrames }),
    ...(description.bitRate === undefined ? {} : { bitRate: description.bitRate }),
    leadingFrames: description.leadingFrames,
    decoder: { ...description.decoder },
    kept: keptSource(kept.source),
  };
  const fileProvenance = kept.source.provenance;
  const source = withFileMetadata(
    {
      media,
      ...(fileProvenance === undefined ? {} : { provenance: { ...fileProvenance, rendition } }),
    },
    keptMetadata(description.metadata),
  );
  const asset: Asset = {
    id: request.assetId,
    displayName: request.displayName,
    origin: AssetOrigin.Imported,
    sampleRate: described.sampleRate,
    channelLayout: described.layout,
    length: frames,
    storageKey: storageKeyOf(request.assetId, media),
    edits: [],
  };
  return {
    asset,
    source,
    placements: importPlacements(
      asset,
      description.metadata,
      description.leadingFrames,
      services.ids,
    ),
    shortfall: 0,
    metadataRefused: undefined,
    release: () => {
      stored.release();
      if (kept.held !== undefined) services.store.release(kept.held);
    },
  };
}

/** How the file itself is kept, as the media store kept it. */
function keptSource(source: AssetSource): KeptCompressedSource {
  const { media } = source;
  return media.kind === 'managed'
    ? { kind: 'copied', contentId: media.contentId }
    : {
        kind: 'linked',
        identity: media.identity,
        ...(media.retainedCopy === undefined ? {} : { retainedCopy: media.retainedCopy }),
      };
}
