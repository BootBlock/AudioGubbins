/**
 * Where packs are kept: the port the installer stores a pack's files through
 * (ADR-0062).
 *
 * The storage package implements it over the storage tree, beside the projects,
 * so packs are kept, counted and cleaned up by the storage and never reached
 * through the origin-private file system directly. A version is first staged:
 * its manifest is kept and its files arrive, each in runs appended where the
 * last stopped, so a paused download keeps what it received and holds no file
 * open while it waits. Once the installer has checked every file it seals the
 * version, and only a sealed version is installed. Files are named by their
 * place in the manifest, so no path of a pack's reaches the tree.
 *
 * A partial download is safe to remove, since nothing unverified is used, so a
 * storage cleanup offers it; the installer runs each transfer through
 * `transferring`, which keeps that cleanup from removing a version while its
 * files are being written.
 *
 * Every method answers the storage's refusals as results; a sink's write
 * rejects with the tree's `TreeFailure` where the storage refuses it.
 */

import type { DomainFailure, DomainResult } from '@audiogubbins/domain';
import type { ByteSink, ByteSource } from '@audiogubbins/project-format';

import type { ModelPackManifest, PackRef } from './manifest.js';

/** A version the store holds, as it was found. */
export type KeptPack =
  /** Every file was checked and the version sealed. */
  | { readonly kind: 'sealed'; readonly manifest: ModelPackManifest }
  /** Its files are arriving or stopped: `received` bytes are kept, in order. */
  | { readonly kind: 'staged'; readonly manifest: ModelPackManifest; readonly received: number }
  /** What is kept of it cannot be read as a pack, for `reason`; it can only be removed. */
  | { readonly kind: 'damaged'; readonly ref: PackRef; readonly reason: DomainFailure };

/** Keeps packs (see the module comment). */
export interface PackStore {
  /** Every version kept, in the order of their ids and then versions. */
  kept(): Promise<DomainResult<readonly KeptPack[]>>;

  /**
   * Starts keeping `manifest`'s version, or carries on with what is staged of
   * it under the same manifest. A version staged under another manifest has its
   * files dropped first; a sealed version is refused, since only its removal
   * may change it.
   */
  stage(manifest: ModelPackManifest): Promise<DomainResult<void>>;

  /** The bytes kept, from the start, of the file at `index` of a staged version. */
  stagedBytes(ref: PackRef, index: number): Promise<DomainResult<number>>;

  /**
   * A sink that keeps the next bytes of the file at `index`, from where
   * `stagedBytes` says its kept bytes end; anything kept past a gap is dropped.
   */
  append(ref: PackRef, index: number): Promise<DomainResult<ByteSink>>;

  /** The bytes kept of the file at `index`, staged or sealed; none where nothing is. */
  open(ref: PackRef, index: number): Promise<DomainResult<ByteSource | undefined>>;

  /** Marks a staged version whole: it is installed from now on. */
  seal(ref: PackRef): Promise<DomainResult<void>>;

  /** Deletes everything kept of a version, its seal first. Absent is not a failure. */
  remove(ref: PackRef): Promise<DomainResult<void>>;

  /**
   * Runs `work`, a transfer that stages, appends to and seals versions, keeping
   * any cleanup of partial downloads from removing them until it ends, and
   * answers what it answers. Waits out a cleanup already running.
   */
  transferring<TValue>(work: () => Promise<TValue>, signal?: AbortSignal): Promise<TValue>;
}
