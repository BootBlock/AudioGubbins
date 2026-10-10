/**
 * Delivering a staged export to where the person chose (ADR-0092,
 * REQ-ARCH-054, REQ-STOR-197): a file a save dialog gave, or a folder, kept
 * trusted or chosen for this export.
 *
 * A folder's collision is decided by `@audiogubbins/import-export`'s rules
 * from the folder's listing at delivery, never assumed: the policy, the answer
 * the person gave for the rest of a batch, and, in a trusted folder, the
 * records of what AudioGubbins exported there before against the size and
 * SHA-256 of the file now there. Where the rules ask, the person is asked, and
 * the delivery waits for the answer. Each destination writes through a sink
 * that replaces the file only when it closes (`createWritable` in the
 * browser), so no destination is ever half written: head, body and tail are
 * streamed from the staging, never held whole.
 *
 * A delivery refused (permission lost, the name skipped or left unanswered, a
 * write the destination refused) leaves the destination as it was and the
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
import {
  answerCollision,
  decideCollision,
  type AnsweredDecision,
  type CollisionAnswer,
  type CollisionPolicy,
  type CollisionQuery,
  type ExportFileName,
  type ExportedFileRecord,
  type ListedFileContent,
} from '@audiogubbins/import-export';
import type { Sha256 } from '@audiogubbins/model-packs';
import {
  CONTENT_CHUNK_BYTES,
  ExportDestinationKind,
  ExportStatus,
  TreeFailure,
  TreeFailureKind,
  hexOf,
  type ByteSink,
  type ByteSource,
  type ExportCodec,
  type ExportRecord,
} from '@audiogubbins/project-format';

import {
  collisionSkipped,
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

  /** A sink for the file of that name, replacing any only once it closes. */
  create(name: string): Promise<ByteSink>;
}

/** What the person answers when asked about a taken name, or nothing where they dismissed it. */
export interface CollisionReply {
  readonly answer: CollisionAnswer;

  /** Whether the answer holds for the rest of the batch. */
  readonly applyToAll: boolean;
}

/** Asks the person what to do with a taken name, waiting for their answer. */
export type CollisionPrompt = (
  name: string,
  signal?: AbortSignal,
) => Promise<CollisionReply | undefined>;

/** Where a staged export is delivered. */
export type DeliveryDestination =
  | { readonly kind: 'file'; readonly file: DeliveryFile }
  | {
      readonly kind: 'folder';
      readonly folder: DeliveryFolder;
      readonly wanted: ExportFileName;
      readonly policy: CollisionPolicy;

      /** The answer given for the rest of the batch, if one was. */
      readonly remembered: CollisionAnswer | undefined;

      /** The records of what was exported to the folder before, where it is trusted. */
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

/** Where a decided delivery writes, and what it replaces. */
type Decided =
  | {
      readonly kind: 'write';
      readonly name: string;
      readonly replaced: 'none' | 'chosen' | 'trusted';
      readonly remembered: CollisionAnswer | undefined;
    }
  | { readonly kind: 'refused'; readonly delivery: Delivery };

/**
 * Delivers the export staged under `token` to `destination` and records it
 * in the session's project as written by `encoder` (see the module comment). Fails only where the
 * export is no longer staged; every other refusal is a delivery refused.
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
  const target = destination.kind === 'file' ? destination.file : destination.folder;
  if ((await target.access()) !== 'granted') {
    return succeed({ kind: 'refused', failure: destinationNeedsPermission(), remembered });
  }
  try {
    const decided =
      destination.kind === 'file'
        ? ({ kind: 'write', name: destination.file.name, replaced: 'none', remembered } as const)
        : await decidedIn(destination, services.sha256, signal);
    if (decided.kind === 'refused') return succeed(decided.delivery);
    const sink =
      destination.kind === 'file'
        ? await destination.file.open()
        : await destination.folder.create(decided.name);
    await written(parts, sink, signal);
    const delivered = await recorded(session, staged, encoder, destination, decided, services);
    await staging.discard(token);
    return succeed(delivered);
  } catch (error) {
    // A destination that refused the file is a delivery refused, the export
    // kept; a cancelled one rejects with why; anything else is a defect.
    if (signal?.aborted === true || !(error instanceof TreeFailure)) throw error;
    return succeed({ kind: 'refused', failure: deliveryRefused(error), remembered });
  }
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

/** Decides a folder delivery's name from its listing, asking the person where the rules ask. */
async function decidedIn(
  destination: Extract<DeliveryDestination, { readonly kind: 'folder' }>,
  sha256: Sha256,
  signal?: AbortSignal,
): Promise<Decided> {
  const { folder, trusted } = destination;
  const listing = await folder.list(signal);
  const base: CollisionQuery = {
    wanted: destination.wanted,
    listing,
    policy: destination.policy,
    remembered: destination.remembered,
    trusted: undefined,
  };
  // Asked with nothing that answers for it, the rules name the file the
  // wanted name takes, if any: the one a trusted folder's records are checked
  // against.
  const taken = decideCollision({ ...base, policy: 'prompt', remembered: undefined });
  const query: CollisionQuery =
    trusted === undefined || taken.kind !== 'ask'
      ? base
      : {
          ...base,
          trusted: {
            records: trusted,
            existing: await contentOf(folder, taken.name, sha256, signal),
          },
        };
  const decision = decideCollision(query);
  if (decision.kind !== 'ask') return outcomeOf(decision, destination.remembered);
  const reply = await destination.prompt(decision.name, signal);
  if (reply === undefined) {
    return {
      kind: 'refused',
      delivery: {
        kind: 'refused',
        failure: collisionSkipped(decision.name),
        remembered: destination.remembered,
      },
    };
  }
  const remembered = reply.applyToAll ? reply.answer : destination.remembered;
  return outcomeOf(answerCollision(query, reply.answer), remembered);
}

/** What a decision comes to. */
function outcomeOf(decision: AnsweredDecision, remembered: CollisionAnswer | undefined): Decided {
  switch (decision.kind) {
    case 'write':
    case 'rename':
      return { kind: 'write', name: decision.name, replaced: 'none', remembered };
    case 'overwrite':
      return {
        kind: 'write',
        name: decision.name,
        replaced: decision.trusted ? 'trusted' : 'chosen',
        remembered,
      };
    case 'skip':
      return {
        kind: 'refused',
        delivery: { kind: 'refused', failure: collisionSkipped(decision.name), remembered },
      };
  }
}

/** The size and SHA-256 of the folder's file of that name, where it is there to read. */
async function contentOf(
  folder: DeliveryFolder,
  name: string,
  sha256: Sha256,
  signal?: AbortSignal,
): Promise<ListedFileContent | undefined> {
  const file = await folder.open(name);
  if (file === undefined) return undefined;
  const run = sha256();
  for (let offset = 0; offset < file.size; offset += CONTENT_CHUNK_BYTES) {
    signal?.throwIfAborted();
    const length = Math.min(CONTENT_CHUNK_BYTES, file.size - offset);
    const chunk = await file.read(offset, length, signal);
    // A file that changed as it was read is not the one any record names.
    if (chunk.length !== length) return undefined;
    await run.update(chunk);
  }
  return { size: file.size, hash: hexOf(await run.digest()) };
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
