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
 */

import { mapResult, type AssetId, type DomainResult, type ProjectId } from '@audiogubbins/domain';
import {
  readProjectTree,
  type ByteSink,
  type ByteSource,
  type Digest,
  type StorageTree,
  type ZipWritten,
} from '@audiogubbins/project-format';

import { openBundle } from './bundle-reading.js';
import { writeBundle } from './bundle-writing.js';
import { CheckedRecords } from './checked-records.js';
import { BackupGenerations } from './backup-generations.js';
import { readProjectCopy, type ProjectCopy } from './project-copy.js';
import {
  directoryTree,
  writeTreeInto,
  type DirectoryReader,
  type DirectoryWriter,
} from './project-directory.js';
import { ProjectFiles } from './project-files.js';
import type { ProjectHeader } from './project-header.js';
import type { RecoveryServices } from './project-recovery.js';
import { storedBodies, treeOfCopy, type CopyOptions, type TreeSources } from './tree-content.js';
import { importTree, type ImportIdentity, type ImportServices } from './tree-import.js';

/** What taking a project out works with, each made once by the composition root. */
export interface ExportServices extends RecoveryServices, TreeSources {
  readonly tree: StorageTree;
  readonly digest: Digest;
}

/** A bundle written, and the assets whose bytes it could not carry. */
export interface ExportedBundle {
  readonly written: ZipWritten;

  /** Assets linked to files outside the storage, with no copy the store keeps. */
  readonly linked: readonly AssetId[];
}

/** Writes a project as a portable bundle into `sink`, and closes it. */
export async function exportBundle(
  project: ProjectId,
  sink: ByteSink,
  options: CopyOptions,
  services: ExportServices,
  signal?: AbortSignal,
): Promise<DomainResult<ExportedBundle>> {
  const files = new ProjectFiles(new CheckedRecords(services.tree, services.digest), project);
  return await writeCopy(
    await readProjectCopy(files, services, signal),
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
): Promise<DomainResult<ExportedBundle>> {
  const generations = new BackupGenerations(services.tree, services.digest, project);
  return await writeCopy(
    await generations.copyOf(generation, signal),
    sink,
    options,
    services,
    signal,
  );
}

async function writeCopy(
  copy: DomainResult<ProjectCopy>,
  sink: ByteSink,
  options: CopyOptions,
  services: ExportServices,
  signal?: AbortSignal,
): Promise<DomainResult<ExportedBundle>> {
  const tree = copy.ok ? await treeOfCopy(copy.value, options, services, signal) : copy;
  if (!tree.ok) {
    await sink.abort(tree.failures[0]);
    return tree;
  }
  const written = await writeBundle(tree.value.files, sink, {
    open: storedBodies(services),
    digest: services.digest,
    proveMedia: false,
    ...(signal === undefined ? {} : { signal }),
  });
  return mapResult(written, (zip) => ({ written: zip, linked: tree.value.linked }));
}

/**
 * Writes a project as an unpacked tree into a directory, and gives the assets
 * whose bytes it could not carry.
 */
export async function exportUnpacked(
  project: ProjectId,
  writer: DirectoryWriter,
  options: CopyOptions,
  services: ExportServices,
  signal?: AbortSignal,
): Promise<DomainResult<readonly AssetId[]>> {
  const files = new ProjectFiles(new CheckedRecords(services.tree, services.digest), project);
  const copy = await readProjectCopy(files, services, signal);
  const tree = copy.ok ? await treeOfCopy(copy.value, options, services, signal) : copy;
  if (!tree.ok) return tree;
  const written = await writeTreeInto(writer, tree.value.files, storedBodies(services), signal);
  return mapResult(written, () => tree.value.linked);
}

/** Brings in the project a bundle holds, as itself or as a copy. */
export async function importBundle(
  source: ByteSource,
  identity: ImportIdentity,
  services: ImportServices,
  signal?: AbortSignal,
): Promise<DomainResult<ProjectHeader>> {
  const bundle = await openBundle(source, services.digest, signal);
  if (!bundle.ok) return bundle;
  const content = await readProjectTree(bundle.value.listing, services.digest, signal);
  if (!content.ok) return content;
  return await importTree(content.value, bundle.value.open, identity, services, signal);
}

/** Brings in the project a directory's unpacked tree holds, as itself or as a copy. */
export async function importUnpacked(
  reader: DirectoryReader,
  identity: ImportIdentity,
  services: ImportServices,
  signal?: AbortSignal,
): Promise<DomainResult<ProjectHeader>> {
  const tree = await directoryTree(reader, signal);
  if (!tree.ok) return tree;
  const content = await readProjectTree(tree.value.listing, services.digest, signal);
  if (!content.ok) return content;
  return await importTree(content.value, tree.value.open, identity, services, signal);
}
