/**
 * Bringing in a file the read contract reads where it lies (ADR-0052,
 * ADR-0090, REQ-AUDIO-220): uncompressed PCM, and the block codes WAV and
 * AIFF-C carry. The asset is the file itself, frame for frame, kept as the
 * person chose, with the audio shape the reader found, the code its samples
 * are stored in and the file's metadata in its provenance (REQ-STOR-166).
 */

import type { AudioFormatDescriptor, SampleEncoding } from '@audiogubbins/codecs';
import {
  AssetOrigin,
  succeed,
  type Asset,
  type AssetId,
  type DomainFailure,
  type DomainResult,
  type ProjectId,
} from '@audiogubbins/domain';
import {
  keptMetadata,
  storageKeyOf,
  type AssetSource,
  type SourceAudioShape,
  type SourceEncoding,
} from '@audiogubbins/project-format';

import { keepFile, withFileMetadata } from './file-keeping.js';
import { checkRoom, roomNeeded, type FileMetadata } from './import-analysis.js';
import type {
  AudioImport,
  AudioImportServices,
  ImportObserver,
  PreparedImport,
} from './import-contracts.js';
import { importPlacements } from './import-placements.js';

/** A file the analysis found the read contract reads in place. */
export interface InPlaceImport extends AudioImport {
  readonly displayName: string;
  readonly project: ProjectId;
  readonly format: AudioFormatDescriptor;
}

/**
 * Keeps `request.file` as the person chose, ready to be added, its metadata
 * read as `metadata` (see the module comment).
 */
export async function prepareInPlace(
  request: InPlaceImport,
  metadata: FileMetadata,
  services: AudioImportServices,
  observe: ImportObserver,
  signal?: AbortSignal,
): Promise<DomainResult<PreparedImport>> {
  const { format } = request;
  const room = await checkRoom(
    roomNeeded(request.file, request.choice, undefined),
    services.room,
    observe,
  );
  if (!room.ok) return room;
  const kept = await keepFile(
    request,
    request.project,
    services,
    observe,
    { audio: audioShape(format) },
    signal,
  );
  if (!kept.ok) return kept;
  const { source, held } = kept.value;
  const read = metadata.kind === 'read' ? metadata.metadata : {};
  const withMetadata = withFileMetadata(source, keptMetadata(read));
  const asset = importedAsset(request.assetId, request.displayName, format, withMetadata);
  return succeed({
    asset,
    source: withMetadata,
    placements: importPlacements(asset, read, 0, services.ids),
    shortfall: format.declaredFrames - format.frames,
    metadataRefused: refusedMetadata(metadata),
    release: () => {
      if (held !== undefined) services.store.release(held);
    },
  });
}

/** The asset an import of a file read in place adds: the shape the reader found. */
function importedAsset(
  assetId: AssetId,
  displayName: string,
  format: AudioFormatDescriptor,
  source: AssetSource,
): Asset {
  return {
    id: assetId,
    displayName,
    origin: AssetOrigin.Imported,
    sampleRate: format.sampleRate,
    channelLayout: format.layout,
    length: format.frames,
    storageKey: storageKeyOf(assetId, source.media),
    edits: [],
  };
}

/** Why a file's metadata was not kept, where it was refused. */
function refusedMetadata(metadata: FileMetadata): DomainFailure | undefined {
  return metadata.kind === 'refused' ? metadata.failure : undefined;
}

/**
 * The audio shape the reader found, as the provenance records it: the
 * container, the rate, the stated layout and the frames, with the encoding its
 * samples are stored in, uncompressed or one of the block codes the read
 * contract reads in place (ADR-0090).
 */
export function audioShape(format: AudioFormatDescriptor): SourceAudioShape {
  return {
    container: format.container,
    sampleRate: format.sampleRate,
    encoding: sourceEncoding(format.encoding),
    ...(format.statedLayout === undefined ? {} : { statedLayout: format.statedLayout }),
    frames: format.frames,
    declaredFrames: format.declaredFrames,
  };
}

/** How a file stores its samples, as the provenance records it. */
function sourceEncoding(encoding: SampleEncoding): SourceEncoding {
  switch (encoding.kind) {
    case 'integer':
    case 'float':
      return { kind: encoding.kind, bits: encoding.bits, byteOrder: encoding.byteOrder };
    case 'g711-alaw':
    case 'g711-ulaw':
      return { kind: encoding.kind };
    case 'ima-adpcm':
    case 'ms-adpcm':
      return { kind: encoding.kind, framesPerBlock: encoding.framesPerBlock };
  }
}
