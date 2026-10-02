/**
 * Taking a project out of the storage and bringing one in: as a portable
 * bundle, or as an unpacked tree in a directory the person chose (REQ-STOR-099,
 * REQ-STOR-103, REQ-STOR-166, REQ-STOR-052).
 *
 * A project is read for export as a read-only window reads it, so exporting
 * changes nothing in storage and needs no lease. The bundle and the tree hold
 * the same files, so what one brings in the other would too. Bringing a project
 * in reads and checks the whole of what it is given before anything is written
 * (`tree-import.ts`).
 *
 * An export is an event of the project's provenance (REQ-STOR-197), which only
 * the window writing the project can record, so each export answers what its
 * provenance needs for whoever records it: the state and the history node it
 * was taken from, as read, and how the writing went, a failure included, and
 * for a bundle the identity of the bytes written. A project that could not be
 * read is the only failure with nothing written and nothing to record.
 */

import {
  mapResult,
  succeed,
  type AssetId,
  type DomainResult,
  type ProjectId,
} from '@audiogubbins/domain';
import {
  readProjectTree,
  stateFingerprintOf,
  type ByteSink,
  type ByteSource,
  type ContentIdentity,
  type Digest,
  type HistoryNodeId,
  type StateFingerprint,
  type StorageTree,
  type ZipWritten,
} from '@audiogubbins/project-format';

import { openBundle } from './bundle-reading.js';
import { writeBundle } from './bundle-writing.js';
import { CheckedRecords } from './checked-records.js';
import { BackupGenerations } from './backup-generations.js';
import { HashingSink } from './hashing-sink.js';
import { readProjectCopy, type ProjectCopy } from './project-copy.js';
import {
  claimDirectory,
  directoryTree,
  writeTreeInto,
  type DirectoryClaim,
  type DirectoryReader,
  type DirectoryWriter,
} from './project-directory.js';
import { ProjectFiles } from './project-files.js';
import type { ProjectSession } from './project-session.js';
import type { RecoveryServices } from './project-recovery.js';
import { storedBodies, treeOfCopy, type CopyOptions, type TreeSources } from './tree-content.js';
import type { ImportIdentity, ImportedProject } from './import-claim.js';
import { importTree, type ImportServices } from './tree-import.js';

/** What taking a project out works with, each made once by the composition root. */
export interface ExportServices extends RecoveryServices, TreeSources {
  readonly tree: StorageTree;
  readonly digest: Digest;
}

/** What an export was taken from: the state written and the history node it is at. */
export interface ExportSource {
  readonly state: StateFingerprint;
  readonly node: HistoryNodeId;
}

/**
 * An export of a project that was read: what it was taken from, and how the
 * writing went, which may have failed with part of the output written.
 */
export interface ExportAttempt<TWritten> {
  readonly source: ExportSource;
  readonly written: DomainResult<TWritten>;

  /** The write failed after it changed the destination, which holds part of the export. */
  readonly partial?: true;
}

/** A bundle written, and the assets whose bytes it could not carry. */
export interface ExportedBundle {
  readonly written: ZipWritten;

  /** Assets linked to files outside the storage, with no copy the store keeps. */
  readonly linked: readonly AssetId[];

  /** The identity of the bundle's bytes, as written. */
  readonly output: ContentIdentity;
}

/** Where an export of a project open to write takes it from. */
export interface ExportFrom {
  /**
   * The session of the project the exporting window writes. Storage holds the
   * project as the session has it only once every change is written, so the
   * export waits for that, and is refused while any change is not saved rather
   * than leave it out unsaid.
   */
  readonly held?: ProjectSession;
}

/** The copy of a project as storage holds it, once `from` has written it all. */
async function exportedCopy(
  project: ProjectId,
  from: ExportFrom,
  services: ExportServices,
  signal?: AbortSignal,
): Promise<DomainResult<ProjectCopy>> {
  if (from.held?.project === project) {
    const saved = await from.held.saved();
    if (!saved.ok) return saved;
  }
  const files = new ProjectFiles(new CheckedRecords(services.tree, services.digest), project);
  return await readProjectCopy(files, services, signal);
}

/**
 * Writes a project as a portable bundle into `sink`, and closes it; abandons it
 * where the project cannot be read or the bundle cannot be written whole.
 */
export async function exportBundle(
  project: ProjectId,
  sink: ByteSink,
  options: CopyOptions & ExportFrom,
  services: ExportServices,
  signal?: AbortSignal,
): Promise<DomainResult<ExportAttempt<ExportedBundle>>> {
  return await writeCopy(
    await exportedCopy(project, options, services, signal),
    sink,
    options,
    services,
    signal,
  );
}

/**
 * Writes one of a project's backup generations as a portable bundle into
 * `sink`, and closes it: a backup kept in the application's storage, taken out
 * on demand (REQ-STOR-105).
 */
export async function exportBackup(
  project: ProjectId,
  generation: number,
  sink: ByteSink,
  options: CopyOptions,
  services: ExportServices,
  signal?: AbortSignal,
): Promise<DomainResult<ExportAttempt<ExportedBundle>>> {
  const generations = new BackupGenerations(services.tree, services.digest, project);
  return await writeCopy(
    await generations.copyOf(generation, signal),
    sink,
    options,
    services,
    signal,
  );
}

/** What a copy is exported from: the state at its history's cursor. */
async function sourceOf(copy: ProjectCopy, digest: Digest): Promise<ExportSource> {
  return {
    state: await stateFingerprintOf(copy.model.state, digest),
    node: copy.model.history.cursor,
  };
}

async function writeCopy(
  copy: DomainResult<ProjectCopy>,
  sink: ByteSink,
  options: CopyOptions,
  services: ExportServices,
  signal?: AbortSignal,
): Promise<DomainResult<ExportAttempt<ExportedBundle>>> {
  if (!copy.ok) {
    await sink.abort(copy.failures[0]);
    return copy;
  }
  const source = await sourceOf(copy.value, services.digest);
  const tree = await treeOfCopy(copy.value, options, services, signal);
  if (!tree.ok) {
    await sink.abort(tree.failures[0]);
    return succeed({ source, written: tree });
  }
  const hashing = new HashingSink(sink, services.digest);
  const written = await writeBundle(tree.value.files, hashing, {
    open: storedBodies(services),
    digest: services.digest,
    proveMedia: false,
    yieldToHost: services.yieldToHost,
    ...(signal === undefined ? {} : { signal }),
  });
  return succeed({
    source,
    written: mapResult(written, (zip) => ({
      written: zip,
      linked: tree.value.linked,
      output: hashing.identity,
    })),
  });
}

/**
 * Writes a project as an unpacked tree into a directory claimed for it as
 * `claim` allows, and gives the assets whose bytes it could not carry. A
 * directory holding another project is refused before anything is read or
 * written, unless the person confirmed replacing it. A failure part of the way
 * through leaves the files written before it in the directory, and the attempt
 * says so.
 */
export async function exportUnpacked(
  project: ProjectId,
  writer: DirectoryWriter,
  options: CopyOptions & DirectoryClaim & ExportFrom,
  services: ExportServices,
  signal?: AbortSignal,
): Promise<DomainResult<ExportAttempt<readonly AssetId[]>>> {
  const claimed = await claimDirectory(writer, project, options, signal);
  if (!claimed.ok) return claimed;
  const copy = await exportedCopy(project, options, services, signal);
  if (!copy.ok) return copy;
  const source = await sourceOf(copy.value, services.digest);
  const tree = await treeOfCopy(copy.value, options, services, signal);
  if (!tree.ok) return succeed({ source, written: tree });
  const { written, changed } = await writeTreeInto(
    claimed.value,
    tree.value.files,
    storedBodies(services),
    signal,
  );
  return succeed({
    source,
    written: mapResult(written, () => tree.value.linked),
    ...(!written.ok && changed ? { partial: true } : {}),
  });
}

/** Brings in the project a bundle holds, as itself or as a copy, as `identity` allows. */
export async function importBundle(
  source: ByteSource,
  identity: ImportIdentity,
  services: ImportServices,
  signal?: AbortSignal,
): Promise<DomainResult<ImportedProject>> {
  const bundle = await openBundle(source, services, signal);
  if (!bundle.ok) return bundle;
  const content = await readProjectTree(bundle.value.listing, services.digest, signal);
  if (!content.ok) return content;
  return await importTree(content.value, bundle.value.open, identity, services, signal);
}

/**
 * Brings in the project a directory's unpacked tree holds, as itself or as a
 * copy, as `identity` allows.
 */
export async function importUnpacked(
  reader: DirectoryReader,
  identity: ImportIdentity,
  services: ImportServices,
  signal?: AbortSignal,
): Promise<DomainResult<ImportedProject>> {
  const tree = await directoryTree(reader, signal);
  if (!tree.ok) return tree;
  const content = await readProjectTree(tree.value.listing, services.digest, signal);
  if (!content.ok) return content;
  return await importTree(content.value, tree.value.open, identity, services, signal);
}
