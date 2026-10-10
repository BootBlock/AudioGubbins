/**
 * What an import of an audio file is given and gives (ADR-0052, ADR-0090):
 * the file and how the person chose to bring it in, the services and the
 * commands it works with, what it reports as it goes, and what it makes.
 *
 * Apart from the import's steps, so the analysis, the file read in place, the
 * decoded file and the batch share them without depending on each other.
 */

import type { CommandInvocation } from '@audiogubbins/commands';
import type {
  Asset,
  AssetId,
  DomainFailure,
  IdGenerator,
  Marker,
  Region,
} from '@audiogubbins/domain';
import type { ImportFileEvent } from '@audiogubbins/import-export';
import type { ExternalFile, ImportChoice, ImportServices } from '@audiogubbins/media-store';
import type { AssetSource, StorageTree } from '@audiogubbins/project-format';

import type { FileDecoding } from './decoded-stream.js';
import type { StorageRoom } from './import-analysis.js';
import type { ImportPlacements } from './import-placements.js';
import type { ChangeOutcome } from './session-contracts.js';
import type { LeaseCoordinator } from './write-lease.js';

/** One audio file to bring into the open project. */
export interface AudioImport {
  readonly file: ExternalFile;
  readonly choice: ImportChoice;

  /** The identity the new asset takes, made by the page's generator. */
  readonly assetId: AssetId;

  /** When the import happens, in whole milliseconds since the epoch. */
  readonly importedAt: number;

  /** The file's analysis and decoding in the codec worker, where it is decoded into a rendition. */
  readonly decoding: FileDecoding;
}

/** The invocations of the project commands an import makes its change of. */
export interface ImportCommands {
  /** The project commands' `addAssetInvocation`. */
  readonly addAsset: (asset: Asset, source: AssetSource) => CommandInvocation;

  /** The project commands' `addRegionInvocation`. */
  readonly addRegion: (region: Region) => CommandInvocation;

  /** The project commands' `addMarkerInvocation`. */
  readonly addMarker: (marker: Marker) => CommandInvocation;
}

/** What an import works with, each made once by the composition root. */
export interface AudioImportServices extends ImportServices {
  readonly commands: ImportCommands;

  /** The tree a rendition's data is written to as it is decoded. */
  readonly tree: StorageTree;
  readonly ids: IdGenerator;

  /** Tokens no other window draws, which name a rendition's scratch file. */
  readonly nextToken: () => string;

  /** The room the storage has left, read before anything is stored. */
  readonly room: StorageRoom;

  /** The platform's lease coordination, absent where it has none. */
  readonly coordinator?: LeaseCoordinator | undefined;
}

/** What an import reports of its file as it goes: each stage, and its progress. */
export type ImportObserver = (event: ImportFileEvent) => void;

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

  /** The regions and markers the file's loops and cues became. */
  readonly placed: { readonly regions: number; readonly markers: number };

  /** The loops and cues that fell outside the asset, and so were not placed. */
  readonly skipped: ImportPlacements['skipped'];

  /** Why the file's metadata was not kept, where it broke its format's rules. */
  readonly metadataRefused?: DomainFailure;
}

/** An import made ready to add: everything it stores stored and held, its change built. */
export interface PreparedImport {
  readonly asset: Asset;
  readonly source: AssetSource;
  readonly placements: ImportPlacements;
  readonly shortfall: number;
  readonly metadataRefused: DomainFailure | undefined;

  /** Lets go of what the import holds in the store. */
  readonly release: () => void;
}
