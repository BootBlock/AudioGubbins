/**
 * Bringing an audio file into an open project as a new asset, in one change
 * undo reverses (ADR-0052, REQ-AUDIO-220, REQ-STOR-025).
 *
 * The file is opened with the read contract first, so a file in a format
 * AudioGubbins does not read, or a malformed one, is refused with the sentence
 * that names what it is before a byte is stored. It is then brought in by copy
 * or by link as the person's setting says, through the media store's own
 * pipeline, and the asset is built from what the reader found: the rate, the
 * layout and the whole frames present, with the file's audio shape in its
 * provenance (REQ-STOR-166). The asset is added by the project command, whose
 * builder the caller gives, since the storage does not depend on the project
 * commands.
 *
 * A managed object the import stored is held in the media store until storage
 * holds the change that refers to it, and released at once where the change is
 * not made, so collection never takes it in between and a cancelled import
 * keeps nothing.
 */

import type { CommandInvocation } from '@audiogubbins/commands';
import { openAudio, type AudioFormatDescriptor } from '@audiogubbins/codecs';
import {
  AssetOrigin,
  succeed,
  type Asset,
  type AssetId,
  type DomainResult,
} from '@audiogubbins/domain';
import {
  importMedia,
  type ExternalFile,
  type ImportChoice,
  type ImportServices,
} from '@audiogubbins/media-store';
import {
  givenName,
  storageKeyOf,
  type AssetSource,
  type SourceAudioShape,
} from '@audiogubbins/project-format';

import { releaseOnceSaved } from './media-holds.js';
import type { ProjectSession } from './project-session.js';
import type { ChangeOutcome } from './session-contracts.js';

/** One audio file to bring into the open project. */
export interface AudioImport {
  readonly file: ExternalFile;
  readonly choice: ImportChoice;

  /** The identity the new asset takes, made by the page's generator. */
  readonly assetId: AssetId;

  /** When the import happens, in whole milliseconds since the epoch. */
  readonly importedAt: number;
}

/** What an import works with, each made once by the composition root. */
export interface AudioImportServices extends ImportServices {
  /** The project commands' `addAssetInvocation`. */
  readonly invocation: (asset: Asset, source: AssetSource) => CommandInvocation;
}

/** An audio file brought in. */
export interface ImportedAudio {
  readonly outcome: ChangeOutcome;
  readonly asset: Asset;

  /**
   * How many frames the header declared that the file does not hold, zero for
   * a whole file: a file cut short is read to its last whole frame, and the
   * person is told by how much it fell short.
   */
  readonly shortfall: number;
}

/** Imports `request.file` into the session's project (see the module comment). */
export async function importAudio(
  session: ProjectSession,
  request: AudioImport,
  services: AudioImportServices,
  signal?: AbortSignal,
): Promise<DomainResult<ImportedAudio>> {
  const { file } = request;
  const opened = await openAudio(file.source, signal);
  if (!opened.ok) return opened;
  const { format } = opened.value;
  const name = assetName(file.fileName);
  if (!name.ok) return name;

  const imported = await importMedia(
    {
      file,
      choice: request.choice,
      projectId: session.getSnapshot().model.state.project.id,
      importedAt: request.importedAt,
      audio: audioShape(format),
    },
    services,
    signal === undefined ? {} : { signal },
  );
  if (!imported.ok) return imported;
  const { source, held } = imported.value;
  const asset: Asset = {
    id: request.assetId,
    displayName: name.value,
    origin: AssetOrigin.Imported,
    sampleRate: format.sampleRate,
    channelLayout: format.layout,
    length: format.frames,
    storageKey: storageKeyOf(request.assetId, source.media),
    edits: [],
  };

  let ran: DomainResult<ChangeOutcome> | undefined;
  try {
    signal?.throwIfAborted();
    ran = await session.run(services.invocation(asset, source));
  } finally {
    if (held !== undefined) {
      const release = (): void => {
        services.store.release(held);
      };
      if (ran?.ok === true && ran.value.kind === 'applied') releaseOnceSaved(session, release);
      else release();
    }
  }
  if (!ran.ok) return ran;
  return succeed({
    outcome: ran.value,
    asset,
    shortfall: format.declaredFrames - format.frames,
  });
}

/** The name an imported file's asset takes: its file name without the extension. */
function assetName(fileName: string): DomainResult<string> {
  const dot = fileName.lastIndexOf('.');
  return givenName('asset', dot > 0 ? fileName.slice(0, dot) : fileName);
}

/** The audio shape the reader found, as the provenance records it. */
function audioShape(format: AudioFormatDescriptor): SourceAudioShape {
  const { encoding } = format;
  return {
    container: format.container,
    sampleRate: format.sampleRate,
    encoding: encoding.kind,
    bitDepth: encoding.bits,
    byteOrder: encoding.byteOrder,
    ...(format.statedLayout === undefined ? {} : { statedLayout: format.statedLayout }),
    frames: format.frames,
    declaredFrames: format.declaredFrames,
  };
}
