/**
 * The model packs, as the page asks the storage worker for them (ADR-0062,
 * REQ-AUDIO-139): the versions the installer knows of, what the catalogue
 * offers, each step of an installation, a version brought in from a folder the
 * person chose, a file of an installed version for a model to run, and each
 * change of an installation as it happens.
 */

import type { DomainResult } from '@audiogubbins/domain';
import type {
  InstallState,
  Installation,
  KeptFile,
  ModelPackManifest,
  PackRef,
} from '@audiogubbins/model-packs';

import type { PackChange, PackImport } from '../protocol/pack-operations.js';
import type { ClientChannel } from '../protocol/storage-operations.js';
import type { LendingCall, PageFolder } from './page-ports.js';

/** The model packs, their installation and their files. */
export interface PacksClient {
  /** Every version the installer knows of, with its manifest where it can be read, and its state. */
  installations(signal?: AbortSignal): Promise<DomainResult<readonly Installation[]>>;

  /** What the catalogue at `catalogue` offers, fetched now: only when the person asks. */
  catalogue(
    catalogue: string,
    signal?: AbortSignal,
  ): Promise<DomainResult<readonly ModelPackManifest[]>>;

  /** Downloads and installs `manifest`'s version from the catalogue; aborting `signal` pauses it. */
  download(
    catalogue: string,
    manifest: ModelPackManifest,
    signal?: AbortSignal,
  ): Promise<DomainResult<InstallState>>;
  resume(
    catalogue: string,
    ref: PackRef,
    signal?: AbortSignal,
  ): Promise<DomainResult<InstallState>>;
  retry(catalogue: string, ref: PackRef, signal?: AbortSignal): Promise<DomainResult<InstallState>>;
  pause(ref: PackRef): Promise<DomainResult<void>>;
  cancel(ref: PackRef): Promise<DomainResult<InstallState>>;

  /**
   * Installs the version `folder` holds, read from it and checked as a download
   * is, fetching nothing; aborting `signal` pauses it.
   */
  importFolder(folder: PageFolder, signal?: AbortSignal): Promise<DomainResult<PackImport>>;

  /** Removes a version; one a project needs only `knowingly`. */
  remove(ref: PackRef, knowingly: boolean): Promise<DomainResult<InstallState>>;

  /** The whole of an installed version's file, with the SHA-256 taken as it was read. */
  read(ref: PackRef, path: string, signal?: AbortSignal): Promise<DomainResult<KeptFile>>;

  /** Hears each state an installation enters, until the answer is called. */
  listen(listener: (change: PackChange) => void): () => void;
}

/** The model packs, over the page's end of the port and the calls that lend its folders. */
export function packsClient(channel: ClientChannel, call: LendingCall): PacksClient {
  return {
    installations: (signal) => channel.call('packs.installations', undefined, { signal }),
    catalogue: (catalogue, signal) => channel.call('packs.catalogue', { catalogue }, { signal }),
    download: (catalogue, manifest, signal) =>
      channel.call('packs.download', { catalogue, manifest }, { signal }),
    resume: (catalogue, ref, signal) =>
      channel.call('packs.resume', { catalogue, ref }, { signal }),
    retry: (catalogue, ref, signal) => channel.call('packs.retry', { catalogue, ref }, { signal }),
    pause: (ref) => channel.call('packs.pause', ref),
    cancel: (ref) => channel.call('packs.cancel', ref),
    importFolder: (folder, signal) =>
      call('packs.import', (lend) => ({ folder: lend.folder(folder) }), signal),
    remove: (ref, knowingly) => channel.call('packs.remove', { ref, knowingly }),
    read: (ref, path, signal) => channel.call('packs.read', { ref, path }, { signal }),
    listen: (listener) => channel.listen('packs', listener),
  };
}
