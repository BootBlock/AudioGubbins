/**
 * An export made ready, or refused, before anything renders or is stored
 * (ADR-0092, REQ-EXEC-216): leave to write where the person chose, the
 * settings planned against the asset as it is heard, a destination that holds
 * one file refused for a batch of several, a codec this browser cannot write
 * with refused with the codecs that serve instead, and the storage's room
 * checked against the staged files at their largest (`staged-size.ts`).
 *
 * Each file is made ready with the audio its span is of, the asset's or its
 * region's as the editor opens it, the metadata it carries, its settings, the
 * folder inside the destination it goes into, and the most it can stage. The
 * Export dialog's files are planned here from its one set of settings; a game
 * export's come planned, each with its own (ADR-0102), and are checked alike.
 */

import type { TrustedFolders } from '@audiogubbins/browser-storage';
import type { PcmDescription } from '@audiogubbins/audio-engine';
import { codecDescriptor, type CodecId, type MetadataMap } from '@audiogubbins/codecs';
import {
  combine,
  fail,
  flatMapResult,
  mapResult,
  succeed,
  type DomainResult,
} from '@audiogubbins/domain';
import {
  planExport,
  type ExportClock,
  type ExportSettings,
  type PlannedFile,
} from '@audiogubbins/import-export';
import type { KeptMetadata, ProjectState } from '@audiogubbins/project-format';
import type { ExportOrigin, ProjectSnapshot } from '@audiogubbins/storage';
import type { RemoteProjectSession } from '@audiogubbins/storage-runtime';
import { counted, quoted } from '@audiogubbins/text';

import type { EditorAsset } from '../assets/editor-asset.js';
import { assetEntryId, regionEntryId } from '../assets/project-entry.js';
import type { CodecServices } from '../codecs/codec-services.js';
import type { AssetCatalogue } from '../state/asset-catalogue.js';
import { describeBytes } from '../wording.js';
import { exportContextOf, servedCodecs } from './export-context.js';
import { exportRefusal } from './export-refusals.js';
import type { StagedRun } from './export-runner.js';
import type {
  ExportDestinationChoice,
  ExportStart,
  PlannedExportFile,
  PlannedExportStart,
  SettingsExportStart,
} from './export-types.js';
import { fileMetadata } from './file-metadata.js';
import { stagedSizeBound } from './staged-size.js';

/** A file of a batch made ready, with everything it needs to be staged and delivered but its origin. */
export interface PreparedJob {
  readonly file: PlannedFile;
  readonly settings: ExportSettings;

  /** The folders inside the destination it goes into, outermost first. */
  readonly folder: readonly string[];
  readonly source: PcmDescription;
  readonly metadata: MetadataMap;
  readonly bound: number;

  /** Where it goes, which a delivery elsewhere changes. */
  destination: ExportDestinationChoice;

  /** The file staged, once it is. */
  staged: StagedRun | undefined;
}

/** A file of a running batch: made ready, with what it was made from and with. */
export interface JobParts extends PreparedJob {
  readonly origin: ExportOrigin;
}

/** An export planned and checked, before its origins are taken and it begins. */
export interface Prepared {
  readonly jobs: readonly PreparedJob[];
  readonly snapshot: ProjectSnapshot;
}

/** What an export is made ready with. */
export interface PreparationParts {
  readonly assets: AssetCatalogue;
  readonly codecs: Pick<CodecServices, 'capability' | 'environment'>;
  readonly clock: () => ExportClock;
}

/** The words for a codec, as the person knows it. */
function codecName(codec: CodecId): string {
  return codecDescriptor(codec).name;
}

/** The entry the editor opens as `id`, or why it is not open. */
function opened(assets: AssetCatalogue, id: string, missing: string): DomainResult<EditorAsset> {
  const asset = assets.find(id);
  if (asset !== undefined) return succeed(asset);
  return fail(exportRefusal('asset-unopened', assets.get().unopened.get(id)?.reason ?? missing));
}

/** Refused where `codec` cannot write here, naming the codecs that serve instead. */
function writable(parts: PreparationParts, codec: CodecId): DomainResult<void> {
  const capability = parts.codecs.capability(codec, 'write');
  if (capability.kind === 'available') return succeed(undefined);
  const instead = capability.alternatives.map(codecName);
  return fail(
    exportRefusal(
      'codec-unavailable',
      instead.length === 0
        ? capability.reason
        : `${capability.reason} ${instead.join(', ')} can be exported here instead.`,
    ),
  );
}

/** What one file of a batch is made ready from. */
interface FileToPrepare {
  readonly asset: EditorAsset;
  readonly file: PlannedFile;
  readonly settings: ExportSettings;
  readonly folder: readonly string[];
  readonly kept: KeptMetadata | undefined;
  readonly destination: ExportDestinationChoice;
}

/** One file's parts: its audio, its metadata and the most it can stage. */
function jobOf(assets: AssetCatalogue, of: FileToPrepare): DomainResult<PreparedJob> {
  const { asset, file, settings, kept, folder, destination } = of;
  const { region } = file.span;
  const heard =
    region === undefined
      ? succeed(undefined)
      : opened(
          assets,
          regionEntryId(region.id),
          `The region ${quoted(region.name)} cannot be heard yet.`,
        );
  return flatMapResult(heard, (entry) =>
    mapResult(fileMetadata(file, settings, { asset, region: entry, kept }), (metadata) => ({
      file,
      settings,
      folder,
      source: (entry ?? asset).describe(),
      metadata,
      bound: stagedSizeBound(settings, file.render.range.length, file.render.layout, metadata),
      destination,
      staged: undefined,
    })),
  );
}

/** Refused where a save dialog's one file is asked to take `files` files. */
function fitsDestination(destination: ExportDestinationChoice, files: number): DomainResult<void> {
  if (files <= 1 || destination.kind !== 'file') return succeed(undefined);
  return fail(
    exportRefusal(
      'one-file-destination',
      `The export makes ${counted(files, 'file', 'files')}, and a save dialog gives one; choose a folder for them.`,
    ),
  );
}

/** The files the Export dialog's one set of settings makes of its asset, made ready. */
function preparedFromSettings(
  parts: PreparationParts,
  state: ProjectState,
  start: SettingsExportStart,
): DomainResult<readonly PreparedJob[]> {
  const { settings, destination } = start;
  const kept = state.sources.get(start.asset)?.provenance?.metadata;
  const asset = opened(
    parts.assets,
    assetEntryId(start.asset),
    'That asset is not in the project open here.',
  );
  return flatMapResult(asset, (editor) =>
    flatMapResult(
      exportContextOf(editor, state, servedCodecs(parts.codecs.environment)),
      (context) =>
        flatMapResult(planExport(settings, context, parts.clock()), (files) => {
          const [first] = files;
          if (first === undefined)
            return fail(exportRefusal('nothing', 'The export makes no file.'));
          return flatMapResult(fitsDestination(destination, files.length), () =>
            flatMapResult(writable(parts, first.target.codec), () =>
              combine(
                files.map((file) =>
                  jobOf(parts.assets, {
                    asset: editor,
                    file,
                    settings,
                    folder: [],
                    kept,
                    destination,
                  }),
                ),
              ),
            ),
          );
        }),
    ),
  );
}

/** One file planned with its own settings, made ready. */
function preparedPlanned(
  parts: PreparationParts,
  state: ProjectState,
  planned: PlannedExportFile,
  destination: ExportDestinationChoice,
): DomainResult<PreparedJob> {
  const asset = opened(
    parts.assets,
    assetEntryId(planned.asset),
    'That asset is not in the project open here.',
  );
  return flatMapResult(asset, (editor) =>
    flatMapResult(writable(parts, planned.file.target.codec), () =>
      jobOf(parts.assets, {
        asset: editor,
        file: planned.file,
        settings: planned.settings,
        folder: planned.folder,
        kept: state.sources.get(planned.asset)?.provenance?.metadata,
        destination,
      }),
    ),
  );
}

/** Whether `start` asks for files planned each with its own settings. */
function isPlanned(start: ExportStart): start is PlannedExportStart {
  return 'files' in start;
}

/** Every file `start` makes, ready to stage, or every reason it cannot start. */
export function prepareExport(
  parts: PreparationParts,
  session: RemoteProjectSession,
  start: ExportStart,
): DomainResult<Prepared> {
  const snapshot = session.getSnapshot();
  const { state } = snapshot.model;
  const jobs = isPlanned(start)
    ? flatMapResult(fitsDestination(start.destination, start.files.length), () =>
        combine(
          start.files.map((planned) => preparedPlanned(parts, state, planned, start.destination)),
        ),
      )
    : preparedFromSettings(parts, state, start);
  return mapResult(jobs, (ready) => ({ jobs: ready, snapshot }));
}

/**
 * Whether the storage has room for every file of the batch at its largest:
 * a delivery refused keeps its file staged beside the next, so the batch's
 * files may all be held at once. Allowed where the estimate gives nothing.
 */
export async function roomFor(
  prepared: Prepared,
  room: () => Promise<number | undefined>,
): Promise<DomainResult<void>> {
  const needed = prepared.jobs.reduce((sum, job) => sum + job.bound, 0);
  const free = await room();
  if (free === undefined || needed <= free) return succeed(undefined);
  return fail(
    exportRefusal(
      'no-room',
      `The export needs up to ${describeBytes(needed)} of storage while it is made, and ${describeBytes(free)} is free, so nothing was rendered. Make room in Storage, or export less at once.`,
      { needed, free },
    ),
  );
}

/**
 * Whether `destination` may be written, asked of the person where the
 * browser needs their leave: before anything renders, or a held file is
 * delivered again, since the delivery itself may only check.
 */
export async function writableDestination(
  destination: ExportDestinationChoice,
  trusted: TrustedFolders | undefined,
  allowWriting: (handle: FileSystemHandle) => Promise<boolean>,
): Promise<DomainResult<void>> {
  let handle: FileSystemHandle;
  switch (destination.kind) {
    case 'download':
      return succeed(undefined);
    case 'file':
    case 'folder':
      handle = destination.handle;
      break;
    case 'trusted-folder': {
      const kept = await trusted?.find(destination.key);
      if (kept === undefined) {
        return fail(
          exportRefusal(
            'trusted-folder-missing',
            'That trusted folder is no longer kept; choose it again, or another destination.',
          ),
        );
      }
      handle = kept.folder;
      break;
    }
  }
  if (await allowWriting(handle)) return succeed(undefined);
  return fail(
    exportRefusal(
      'permission-refused',
      `AudioGubbins was not given leave to write to ${quoted(handle.name)}, so nothing was written there.`,
    ),
  );
}
