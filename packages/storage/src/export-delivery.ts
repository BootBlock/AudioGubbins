/**
 * Delivering a staged export to where the person chose (ADR-0092,
 * REQ-ARCH-054, REQ-STOR-197): a file a save dialog gave, or a folder, kept
 * trusted or chosen for this export, or a relative folder inside it
 * (ADR-0102), walked down before anything is decided (`delivery-folders.ts`).
 *
 * A folder's collision is decided from the listing of the folder written into
 * at delivery, never assumed (`export-collision.ts`), the person asked where
 * the rules ask; a folder not there yet lists nothing. Each
 * destination writes through a sink that replaces the file only when it closes
 * (`createWritable` in the browser), so no destination is ever half written:
 * head, body and tail are streamed from the staging, never held whole.
 *
 * A delivery refused (permission lost, a folder path that is not one inside
 * the folder, the name skipped or left unanswered, a folder or a write the
 * destination refused) leaves the destination as it was and the
 * export staged, so a retry or another destination needs no new render. A
 * delivered export is recorded in the project's history as an export record,
 * never as a change undo reverses (REQ-STOR-198), and its staging given up.
 */

import type { Clock } from '@audiogubbins/diagnostics';
import {
  fail,
  succeed,
  type DomainFailure,
  type DomainResult,
  type IdGenerator,
} from '@audiogubbins/domain';
import type {
  CollisionAnswer,
  CollisionPolicy,
  ExportFileName,
  ExportedFileRecord,
} from '@audiogubbins/import-export';
import type { Sha256 } from '@audiogubbins/model-packs';
import {
  CONTENT_CHUNK_BYTES,
  ExportDestinationKind,
  ExportStatus,
  TreeFailure,
  TreeFailureKind,
  type ByteSink,
  type ByteSource,
  type ExportCodec,
  type ExportRecord,
} from '@audiogubbins/project-format';

import { folderReached } from './delivery-folders.js';
import { decidedIn, recordsIn, type CollisionPrompt, type Decided } from './export-collision.js';
import {
  deliveryRefused,
  destinationNeedsPermission,
  stagedExportMissing,
} from './export-failures.js';
import type { ExportStaging, StagedExport } from './export-staging.js';
import type { ProjectSession } from './project-session.js';

/** Whether a destination may be written now, without asking the person. */
export type DestinationAccess = 'granted' | 'needs-permission';

/** A file a save dialog gave: written whole, replacing what it held only once it closes. */
export interface DeliveryFile {
  /** The file's name, as the person knows it. */
  readonly name: string;
  access(): Promise<DestinationAccess>;
  open(): Promise<ByteSink>;
}

/** A folder to deliver into: its listing, its files, and a new file written whole. */
export interface DeliveryFolder {
  /** The folder's name, as the person knows it, never a path. */
  readonly name: string;
  access(): Promise<DestinationAccess>;

  /** The name of every entry the folder holds now. */
  list(signal?: AbortSignal): Promise<readonly string[]>;

  /** The file of that name, where there is one. */
  open(name: string): Promise<ByteSource | undefined>;

  /**
   * The folder of that name inside this one: the one there, or, where nothing
   * has the name, one still to be made, which lists nothing and is made, with
   * every folder above it still to be made, only when a file is created in it,
   * and removed again where that file's writing is abandoned. `undefined`
   * where a file has the name.
   */
  folder(name: string, signal?: AbortSignal): Promise<DeliveryFolder | undefined>;

  /**
   * A sink for the file of that name, replacing any only once it closes,
   * making the folder first where it is still to be made: a refusal or
   * `signal` part-way removes the folders made, and the file is then written
   * only where nothing has taken its name since the folder listed nothing.
   */
  create(name: string, signal?: AbortSignal): Promise<ByteSink>;
}

/** Where a staged export is delivered. */
export type DeliveryDestination =
  | { readonly kind: 'file'; readonly file: DeliveryFile }
  | {
      readonly kind: 'folder';
      readonly folder: DeliveryFolder;

      /**
       * The folders from `folder` down to the one written into, outermost
       * first; none is `folder` itself (ADR-0102).
       */
      readonly path: readonly string[];
      readonly wanted: ExportFileName;
      readonly policy: CollisionPolicy;

      /** The answer given for the rest of the batch, if one was. */
      readonly remembered: CollisionAnswer | undefined;

      /**
       * The records of what was exported to the folder before, where it is
       * trusted, each naming its file by its path from `folder`
       * (`trustedRecordName`).
       */
      readonly trusted: readonly ExportedFileRecord[] | undefined;
      readonly prompt: CollisionPrompt;
    };

/** What delivering works with, each made once by the composition root. */
export interface DeliveryServices {
  readonly sha256: Sha256;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

/** How a delivery ended: written, or refused with the export left staged. */
export type Delivery =
  | {
      readonly kind: 'delivered';

      /** The name the file was written under. */
      readonly name: string;

      /** Whether a file was replaced: none, one the person or policy chose to, or a trusted export. */
      readonly replaced: 'none' | 'chosen' | 'trusted';
      readonly record: ExportRecord;

      /** Why the record could not be kept in the project's history, where it could not. */
      readonly unrecorded?: DomainFailure;

      /** The answer to hold for the rest of the batch, where the person gave one. */
      readonly remembered: CollisionAnswer | undefined;
    }
  | {
      readonly kind: 'refused';
      readonly failure: DomainFailure;
      readonly remembered: CollisionAnswer | undefined;
    };

/**
 * Delivers the export staged under `token` to `destination` and records it
 * in the session's project as written by `encoder` (see the module comment).
 * Fails only where the export is no longer staged; every other refusal is a
 * delivery refused.
 */
export async function deliverStaged(
  session: ProjectSession,
  staging: ExportStaging,
  token: string,
  encoder: ExportCodec,
  destination: DeliveryDestination,
  services: DeliveryServices,
  signal?: AbortSignal,
): Promise<DomainResult<Delivery>> {
  const staged = staging.staged(token);
  const parts = staged === undefined ? undefined : await staging.parts(staged);
  if (staged === undefined || parts === undefined) {
    await staging.discard(token);
    return fail(stagedExportMissing(token));
  }
  const remembered = destination.kind === 'folder' ? destination.remembered : undefined;
  const chosen = destination.kind === 'file' ? destination.file : destination.folder;
  if ((await chosen.access()) !== 'granted') {
    return succeed({ kind: 'refused', failure: destinationNeedsPermission(), remembered });
  }
  try {
    const target =
      destination.kind === 'file'
        ? fileTarget(destination.file, remembered)
        : await folderTarget(destination, services.sha256, signal);
    if (target.kind === 'refused') return succeed(target);
    await written(parts, await target.open(signal), signal);
    const delivered = await recorded(
      session,
      staged,
      encoder,
      destination,
      target.decided,
      services,
    );
    await staging.discard(token);
    return succeed(delivered);
  } catch (error) {
    // A destination that refused the file is a delivery refused, the export
    // kept; a cancelled one rejects with why; anything else is a defect.
    if (signal?.aborted === true || !(error instanceof TreeFailure)) throw error;
    return succeed({ kind: 'refused', failure: deliveryRefused(error), remembered });
  }
}

/** A file a delivery decided to write, and how it is opened; or why it writes nothing. */
type Target =
  | Extract<Decided, { readonly kind: 'refused' }>
  | {
      readonly kind: 'write';
      readonly decided: Extract<Decided, { readonly kind: 'write' }>;
      open(signal?: AbortSignal): Promise<ByteSink>;
    };

/** A save dialog's file: written under its own name, which it holds whatever is there. */
function fileTarget(file: DeliveryFile, remembered: CollisionAnswer | undefined): Target {
  return {
    kind: 'write',
    decided: { kind: 'write', name: file.name, replaced: 'none', remembered },
    open: () => file.open(),
  };
}

/**
 * The folder the destination's path leads to, and the name its listing, the
 * rules and the person decide, against the trusted records of that folder.
 */
async function folderTarget(
  destination: Extract<DeliveryDestination, { readonly kind: 'folder' }>,
  sha256: Sha256,
  signal?: AbortSignal,
): Promise<Target> {
  const reached = await folderReached(destination.folder, destination.path, signal);
  if (reached.kind === 'refused') return { ...reached, remembered: destination.remembered };
  const { folder } = reached;
  const trusted =
    destination.trusted === undefined
      ? undefined
      : recordsIn(destination.trusted, destination.path);
  const decided = await decidedIn({ ...destination, folder, trusted }, sha256, signal);
  if (decided.kind === 'refused') return decided;
  return { kind: 'write', decided, open: (cancel) => folder.create(decided.name, cancel) };
}

/**
 * The record of a delivered export, as the project's history keeps it: what
 * was rendered and how, the encoder that wrote it, where it went, and the
 * file written.
 */
export function exportRecordOf(
  staged: StagedExport,
  encoder: ExportCodec,
  destination: { readonly kind: ExportDestinationKind; readonly label?: string },
  fileName: string,
  services: Pick<DeliveryServices, 'ids' | 'clock'>,
): ExportRecord {
  const { origin } = staged;
  return {
    id: services.ids.next<'ExportRecordId'>(),
    at: services.clock.now(),
    stateFingerprint: origin.stateFingerprint,
    ...(origin.historyNodeId === undefined ? {} : { historyNodeId: origin.historyNodeId }),
    engineVersions: origin.engineVersions,
    output: { container: origin.settings.format, settings: new Map() },
    destination,
    file: {
      settings: origin.settings,
      fileName,
      byteLength: staged.bytes,
      sha256: staged.sha256,
      codec: encoder,
      reproducible: origin.reproducible,
    },
    status: ExportStatus.Succeeded,
    problems: [],
  };
}

/** Streams the staged parts into `sink` and closes it, abandoning it where anything fails. */
async function written(
  parts: readonly ByteSource[],
  sink: ByteSink,
  signal?: AbortSignal,
): Promise<void> {
  let closed = false;
  try {
    for (const part of parts) {
      for (let offset = 0; offset < part.size; offset += CONTENT_CHUNK_BYTES) {
        signal?.throwIfAborted();
        const length = Math.min(CONTENT_CHUNK_BYTES, part.size - offset);
        const chunk = await part.read(offset, length, signal);
        if (chunk.length !== length) {
          throw new TreeFailure(
            TreeFailureKind.Io,
            'The staged export changed as it was delivered.',
          );
        }
        await sink.write(chunk);
      }
    }
    await sink.close();
    closed = true;
  } finally {
    if (!closed) await sink.abort();
  }
}

/** Records the delivered export in the session's project. */
async function recorded(
  session: ProjectSession,
  staged: StagedExport,
  encoder: ExportCodec,
  destination: DeliveryDestination,
  decided: Extract<Decided, { readonly kind: 'write' }>,
  services: DeliveryServices,
): Promise<Delivery> {
  const where =
    destination.kind === 'file'
      ? { kind: ExportDestinationKind.File, label: destination.file.name }
      : {
          kind:
            destination.trusted === undefined
              ? ExportDestinationKind.Directory
              : ExportDestinationKind.TrustedDirectory,
          label: destination.folder.name,
        };
  const record = exportRecordOf(staged, encoder, where, decided.name, services);
  const kept = await session.recordExport(record);
  return {
    kind: 'delivered',
    name: decided.name,
    replaced: decided.replaced,
    record,
    ...(kept.ok ? {} : { unrecorded: kept.failures[0] }),
    remembered: decided.remembered,
  };
}
