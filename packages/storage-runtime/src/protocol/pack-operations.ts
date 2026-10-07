/**
 * What the page asks the storage worker of model packs (ADR-0062,
 * REQ-AUDIO-139): the versions the installer knows of, what the catalogue
 * offers, each step of a version's installation and removal, and a file of an
 * installed version read for a model to run.
 *
 * The installer is the worker's, beside the store it keeps packs in, so every
 * change of a version, a cleanup's removal among them, is one its state
 * machine takes. The catalogue is the one the build configures, whose URL the
 * page gives with each call that reaches it, and is asked for nothing unless
 * the person asks: opening a project calls none of these but `installations`
 * and `read`, which read only what is kept.
 */

import type { DomainResult } from '@audiogubbins/domain';
import type {
  InstallState,
  Installation,
  KeptFile,
  ModelPackManifest,
  PackRef,
} from '@audiogubbins/model-packs';

import type { Operation } from './operations.js';

/** The URL of the catalogue the build configures: the directory its files are under, ending in `/`. */
export interface CatalogueAt {
  readonly catalogue: string;
}

/** The operations of model packs. */
export type PackOperations = {
  /** Every version the installer knows of, what the store keeps learnt first. */
  'packs.installations': Operation<undefined, DomainResult<readonly Installation[]>>;

  /** What the catalogue offers, fetched now. */
  'packs.catalogue': Operation<CatalogueAt, DomainResult<readonly ModelPackManifest[]>>;

  /**
   * Downloads `manifest`'s version from the catalogue, checks it and keeps it,
   * answering the state it ended in; abandoning the call pauses it.
   */
  'packs.download': Operation<
    CatalogueAt & { readonly manifest: ModelPackManifest },
    DomainResult<InstallState>
  >;
  'packs.resume': Operation<CatalogueAt & { readonly ref: PackRef }, DomainResult<InstallState>>;
  'packs.retry': Operation<CatalogueAt & { readonly ref: PackRef }, DomainResult<InstallState>>;
  'packs.pause': Operation<PackRef, DomainResult<void>>;
  'packs.cancel': Operation<PackRef, DomainResult<InstallState>>;

  /**
   * Removes an installed or failed version; one a project needs is refused
   * unless `knowingly` says the person was told and removes it anyway.
   */
  'packs.remove': Operation<
    { readonly ref: PackRef; readonly knowingly: boolean },
    DomainResult<InstallState>
  >;

  /**
   * The whole of an installed version's file, checked as it is read, with the
   * SHA-256 taken as it was; its buffer is moved to the page.
   */
  'packs.read': Operation<{ readonly ref: PackRef; readonly path: string }, DomainResult<KeptFile>>;
};

/** A version's installation entering a state, as the stream of packs carries it. */
export interface PackChange {
  readonly ref: PackRef;
  readonly state: InstallState;
}
