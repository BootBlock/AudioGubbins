/**
 * An export made ready, or refused, before anything renders or is stored
 * (ADR-0092, REQ-EXEC-216): leave to write where the person chose, the
 * settings planned against the asset as it is heard, a destination that holds
 * one file refused for a batch of several, a codec this browser cannot write
 * with refused with the codecs that serve instead, and the storage's room
 * checked against the staged files at their largest (`staged-size.ts`).
 *
 * Each file is made ready with the audio its span is of, the asset's or its
 * region's as the editor opens it, the metadata it carries, and the most it
 * can stage.
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
  type ExportTarget,
  type PlannedFile,
} from '@audiogubbins/import-export';
import type { KeptMetadata } from '@audiogubbins/project-format';
import type { ProjectSnapshot } from '@audiogubbins/storage';
import type { RemoteProjectSession } from '@audiogubbins/storage-runtime';
import { counted, quoted } from '@audiogubbins/text';

import type { EditorAsset } from '../assets/editor-asset.js';
import { assetEntryId, regionEntryId } from '../assets/project-entry.js';
import type { CodecServices } from '../codecs/codec-services.js';
import type { AssetCatalogue } from '../state/asset-catalogue.js';
import { describeBytes } from '../wording.js';
import { exportContextOf } from './export-context.js';
import { exportRefusal } from './export-refusals.js';
import type { StagedRun } from './export-runner.js';
import type { ExportDestinationChoice, ExportStart } from './export-types.js';
import { fileMetadata } from './file-metadata.js';
import { stagedSizeBound } from './staged-size.js';

/** A file of a batch, with everything it needs to be staged and delivered. */
export interface JobParts {
  readonly file: PlannedFile;
  readonly source: PcmDescription;
  readonly metadata: MetadataMap;
  readonly bound: number;

  /** Where it goes, which a delivery elsewhere changes. */
  destination: ExportDestinationChoice;

  /** The file staged, once it is. */
  staged: StagedRun | undefined;
}

/** An export planned and checked, before its origin is taken and it begins. */
export interface Prepared {
  readonly jobs: readonly JobParts[];
  readonly snapshot: ProjectSnapshot;
  readonly target: ExportTarget;
}

/** What an export is made ready with. */
export interface PreparationParts {
  readonly assets: AssetCatalogue;
  readonly codecs: Pick<CodecServices, 'capability'>;
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

/** One file's parts: its audio, its metadata and the most it can stage. */
function jobOf(
  assets: AssetCatalogue,
  asset: EditorAsset,
  file: PlannedFile,
  settings: ExportSettings,
  kept: KeptMetadata | undefined,
  destination: ExportDestinationChoice,
): DomainResult<JobParts> {
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
      source: (entry ?? asset).describe(),
      metadata,
      bound: stagedSizeBound(settings, file.render.range.length, file.render.layout, metadata),
      destination,
      staged: undefined,
    })),
  );
}

/** Every file `start` makes, ready to stage, or every reason it cannot start. */
export function prepareExport(
  parts: PreparationParts,
  session: RemoteProjectSession,
  start: ExportStart,
): DomainResult<Prepared> {
  const { settings, destination } = start;
  const snapshot = session.getSnapshot();
  const { state } = snapshot.model;
  const kept = state.sources.get(start.asset)?.provenance?.metadata;
  const asset = opened(
    parts.assets,
    assetEntryId(start.asset),
    'That asset is not in the project open here.',
  );
  return flatMapResult(asset, (editor) =>
    flatMapResult(exportContextOf(editor, state), (context) =>
      flatMapResult(planExport(settings, context, parts.clock()), (files) => {
        const [first] = files;
        if (first === undefined) return fail(exportRefusal('nothing', 'The export makes no file.'));
        if (files.length > 1 && destination.kind === 'file') {
          return fail(
            exportRefusal(
              'one-file-destination',
              `The export makes ${counted(files.length, 'file', 'files')}, and a save dialog gives one; choose a folder for them.`,
            ),
          );
        }
        return flatMapResult(writable(parts, first.target.codec), () =>
          mapResult(
            combine(
              files.map((file) => jobOf(parts.assets, editor, file, settings, kept, destination)),
            ),
            (jobs) => ({ jobs, snapshot, target: first.target }),
          ),
        );
      }),
    ),
  );
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
