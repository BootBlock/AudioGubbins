/**
 * Bringing a compressed file into a project as a decoded rendition (ADR-0090,
 * REQ-ARCH-049, REQ-ARCH-085).
 *
 * The codec worker analyses and decodes; the storage only writes. The codec
 * worker's analysis of the file's headers comes first, and is sized before
 * anything is stored: the file is refused where the storage has no room for
 * the file itself, where it is copied, and the rendition, whose size the
 * stream's stated length gives. The file is then kept as the person chose,
 * copied into the store or linked where it lies, and the stream's blocks are
 * written as they arrive (`rendition-receiving.ts`) and stored as a 32-bit
 * float WAV file as every file the storage makes itself is (`stored-wav.ts`),
 * at the stream's own rate, never resampled. The asset is the rendition: its
 * provenance names the file it was decoded from, its codec, the decoder and
 * its version, and how the file is kept, and the file's metadata, whose loops
 * and cues are placed on the asset in its frames. The decoded stream begins
 * with its description, which is refused where it is not the stream analysed.
 *
 * A stream refused, failed part way or cancelled keeps nothing: the codec
 * worker is told, the scratch file is removed, and every object stored is let
 * go, for collection to take.
 */

import {
  AssetOrigin,
  fail,
  layoutsMatch,
  succeed,
  type Asset,
  type DomainFailure,
  type DomainResult,
  type ProjectId,
} from '@audiogubbins/domain';
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
import type { DecodedStream, StreamAnalysis } from './decoded-stream.js';
import { checkRoom, keepsCopy, renditionBytes } from './import-analysis.js';
import { renditionReadBackDiffers, streamOutOfOrder } from './import-failures.js';
import { importPlacements } from './import-placements.js';
import { receiveRendition } from './rendition-receiving.js';
import { renditionScratchPath } from './staging-paths.js';
import { mediaSharingOf } from './storage-sharing.js';
import { storeFloatWav, storedWavMedia, type StoredWav } from './stored-wav.js';

/** A file the analysis routed to a decode, ready to be decoded. */
export interface DecodedImport extends AudioImport {
  readonly displayName: string;
  readonly project: ProjectId;
}

/**
 * Analyses `request.file` in the codec worker, keeps it as the person chose,
 * and decodes it into a rendition, ready to be added (see the module
 * comment). Rejects with the signal's reason, having kept nothing, where the
 * import is cancelled.
 */
export async function prepareDecoded(
  request: DecodedImport,
  services: AudioImportServices,
  observe: ImportObserver,
  signal?: AbortSignal,
): Promise<DomainResult<PreparedImport>> {
  const analysed = await request.decoding.analyse(signal);
  if (!analysed.ok) return analysed;
  const analysis = analysed.value;
  const sized = await sizedFor(request, analysis, services);
  if (!sized.ok) return sized;
  let kept: ImportedMedia | undefined;
  let stored: StoredWav | undefined;
  try {
    const keeping = await keepFile(request, request.project, services, observe, {}, signal);
    if (!keeping.ok) return keeping;
    kept = keeping.value;
    const decoding = await request.decoding.decode(signal);
    if (!decoding.ok) return decoding;
    const described = await describedAs(decoding.value, analysis);
    if (!described.ok) return described;
    const rendition = await decodedInto(
      decoding.value,
      analysis,
      request,
      services,
      observe,
      signal,
    );
    if (!rendition.ok) return rendition;
    stored = rendition.value;
    return succeed(prepared(request, analysis, kept, stored, services));
  } finally {
    // What the import holds is let go here unless it is prepared, when the
    // change that refers to it lets it go once it is written.
    if (stored === undefined && kept?.held !== undefined) services.store.release(kept.held);
  }
}

/**
 * Reads the stream's description, first, and checks it is the stream the
 * analysis sized: at its rate, in its channels. Refuses the stream where not.
 */
async function describedAs(
  stream: DecodedStream,
  analysis: StreamAnalysis,
): Promise<DomainResult<void>> {
  const first = await stream.next();
  if (first?.kind === 'failed') return fail(first.failure);
  if (first?.kind !== 'description') {
    return refused(stream, streamOutOfOrder('the stream did not begin with its description'));
  }
  const { description } = first;
  if (
    description.sampleRate !== analysis.sampleRate ||
    !layoutsMatch(description.layout, analysis.layout)
  ) {
    return refused(stream, streamOutOfOrder('the stream decoded was not the one analysed'));
  }
  return succeed(undefined);
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
  analysis: StreamAnalysis,
  services: AudioImportServices,
): Promise<DomainResult<void>> {
  const { sampleRate: rate, layout, statedFrames } = analysis;
  const rendition = renditionBytes({ sampleRate: rate, layout }, statedFrames);
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
  analysis: StreamAnalysis,
  request: DecodedImport,
  services: AudioImportServices,
  observe: ImportObserver,
  signal?: AbortSignal,
): Promise<DomainResult<StoredWav>> {
  observe({ kind: 'decode', framesTotal: analysis.statedFrames });
  const release = await mediaSharingOf(services.coordinator).share(signal);
  try {
    const scratch = {
      tree: services.tree,
      path: renditionScratchPath(request.project, services.nextToken()),
    };
    const received = await receiveRendition(
      stream,
      analysis.layout,
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
        { sampleRate: analysis.sampleRate, layout: analysis.layout },
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
  analysis: StreamAnalysis,
  kept: ImportedMedia,
  stored: StoredWav,
  services: AudioImportServices,
): PreparedImport {
  const media = storedWavMedia(stored);
  const fileProvenance = kept.source.provenance;
  const rendition = renditionRecord(analysis, kept, stored);
  const metadata = analysis.metadata.kind === 'read' ? analysis.metadata.metadata : {};
  const source = withFileMetadata(
    {
      media,
      ...(fileProvenance === undefined ? {} : { provenance: { ...fileProvenance, rendition } }),
    },
    keptMetadata(metadata),
  );
  const asset: Asset = {
    id: request.assetId,
    displayName: request.displayName,
    origin: AssetOrigin.Imported,
    sampleRate: analysis.sampleRate,
    channelLayout: analysis.layout,
    length: rendition.frames,
    storageKey: storageKeyOf(request.assetId, media),
    edits: [],
  };
  return {
    asset,
    source,
    placements: importPlacements(asset, metadata, analysis.leadingFrames, services.ids),
    shortfall: 0,
    metadataRefused: analysis.metadata.kind === 'refused' ? analysis.metadata.failure : undefined,
    release: () => {
      stored.release();
      if (kept.held !== undefined) services.store.release(kept.held);
    },
  };
}

/** What the asset's provenance records of the file its rendition was decoded from. */
function renditionRecord(
  analysis: StreamAnalysis,
  kept: ImportedMedia,
  stored: StoredWav,
): DecodedRendition {
  return {
    container: analysis.container,
    codec: analysis.codec,
    sampleRate: analysis.sampleRate,
    layout: analysis.layout,
    frames: stored.format.frames,
    ...(analysis.statedFrames === undefined ? {} : { statedFrames: analysis.statedFrames }),
    ...(analysis.bitRate === undefined ? {} : { bitRate: analysis.bitRate }),
    leadingFrames: analysis.leadingFrames,
    decoder: { ...analysis.decoder },
    kept: keptSource(kept.source),
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
