/**
 * The model packs as the person manages them (REQ-AUDIO-139, ADR-0062): every
 * version the storage worker's installer knows of, in the state the installer
 * says it is in, what the catalogue offers, and each step a person takes with
 * a pack, which the installer, the one authority on a version's state
 * (REQ-ARCH-153), carries out.
 *
 * What is kept is read from the worker when the manager is first looked at or
 * used, and then followed change by change as the installer reports them
 * (`listen`), each brought in place: a download's progress replaces its one
 * version and leaves every other the value it was. Nothing is fetched to read
 * it. The catalogue, the build's own (`PACK_CATALOGUE`), is fetched only when
 * the person asks: opening the manager or asking it to look again, never
 * because a project opened.
 *
 * A download, a resume, a retry and an import each hold their call to the
 * worker until the version settles, installed, paused, failed or cancelled, so
 * what they come to can be said; the page going away gives each up, which
 * pauses it, keeping what arrived. A removal a project's need refuses is kept
 * as the reason, so the manager can say which version is needed and offer to
 * remove it knowingly; it is forgotten once the version is gone or the person
 * does anything else with it.
 */

import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';
import {
  VERSION_PINNED,
  manifestJson,
  packKey,
  refOf,
  type InstallState,
  type Installation,
  type ModelPackManifest,
  type PackRef,
} from '@audiogubbins/model-packs';
import type {
  PackChange,
  PackImport,
  PacksClient,
  PageFolder,
} from '@audiogubbins/storage-runtime';

import { Requests, isAbandoned } from '../state/abandoning.js';
import { observable, type Observable } from '../state/observable.js';
import type { KnownAvailability } from './model-availability.js';

/** What the catalogue has been found to offer. */
export type CatalogueReading =
  /** Not asked this session. */
  | { readonly kind: 'unasked' }
  /** Being fetched now; `packs` are what it offered when last read, where it was. */
  | { readonly kind: 'reading'; readonly packs: readonly ModelPackManifest[] }
  | { readonly kind: 'read'; readonly packs: readonly ModelPackManifest[] }
  /** Could not be read, for `reason`; `packs` are what it offered when last read. */
  | {
      readonly kind: 'failed';
      readonly reason: string;
      readonly packs: readonly ModelPackManifest[];
    };

/** The model packs as the manager shows them. */
export interface PackManagerState {
  /** Every version the installer knows of, in its state, in the installer's order. */
  readonly installations: readonly Installation[];

  /** Whether what is kept has been read yet. */
  readonly loaded: boolean;

  /** Why what is kept could not be read the last time it was, where it could not. */
  readonly problem?: string;
  readonly catalogue: CatalogueReading;

  /**
   * Each version whose removal was refused because a project needs it, by
   * `packKey`, with the reason given: what the manager offers to remove
   * knowingly.
   */
  readonly needed: ReadonlyMap<string, string>;
}

/** What the manager works through. */
export interface PackManagerParts {
  /** The installer's operations, absent where this browser keeps no packs. */
  readonly packs: PacksClient | undefined;

  /** The URL of the catalogue the build configures, worked out when first asked for. */
  readonly catalogueUrl: () => Promise<string>;

  /** A pack's folder the person chooses, or nothing where they dismiss the chooser. */
  readonly chooseFolder: () => Promise<PageFolder | undefined>;

  /** Which of the conditions holds for what is kept, read from the same installer. */
  readonly availability: Observable<KnownAvailability>;

  /** The page's life: once it ends, every call given up and nothing more followed. */
  readonly lifetime: AbortSignal;
}

/**
 * The manager as a surface reads it: its state, why nothing can be done here,
 * and availability, with none of the steps that change a pack, which a surface
 * takes only through the commands (`CLAUDE.md` G2).
 */
export type PackManagerView = Pick<
  PackManager,
  'get' | 'subscribe' | 'unavailable' | 'availability'
>;

/** Why nothing can be done with packs in a browser that keeps none. */
export const NO_PACKS =
  'This browser cannot keep model packs, so none can be installed, imported or removed here.';

/** Why a version the catalogue did not offer when last read is not installed. */
export const NOT_OFFERED =
  'The catalogue, as it was last read, does not offer that version. Check the catalogue again.';

function refusedFor(code: string, summary: string): DomainResult<never> {
  return fail(failure(code, FailureKind.Rejected, summary));
}

/** Whether two states say the same: their kind, their numbers and any reason. */
function sameState(one: InstallState, other: InstallState): boolean {
  return JSON.stringify(stateFacts(one)) === JSON.stringify(stateFacts(other));
}

/** What a state says, as a value two states can be compared by. */
function stateFacts(state: InstallState): readonly unknown[] {
  switch (state.kind) {
    case 'queued':
    case 'downloading':
    case 'paused':
      return [state.kind, state.received, state.total];
    case 'verifying':
      return [state.kind, state.total];
    case 'failed':
      return [state.kind, state.reason.code, state.reason.summary, state.resumable, state.received];
    case 'available':
    case 'installed':
    case 'removing':
      return [state.kind];
  }
}

/** Whether two readings of one version say the same of it. */
function sameInstallation(one: Installation, other: Installation): boolean {
  const manifests =
    one.manifest === undefined || other.manifest === undefined
      ? one.manifest === other.manifest
      : JSON.stringify(manifestJson(one.manifest)) === JSON.stringify(manifestJson(other.manifest));
  return manifests && sameState(one.state, other.state);
}

/** The position `ref` takes in a list in the installer's order, by key. */
function placeOf(installations: readonly Installation[], key: string): number {
  const after = installations.findIndex((one) => packKey(one.ref) > key);
  return after < 0 ? installations.length : after;
}

/** The model packs a person manages (see the module comment). */
export class PackManager implements Observable<PackManagerState> {
  readonly availability: Observable<KnownAvailability>;
  private readonly parts: PackManagerParts;
  private readonly readings: Requests;
  private readonly catalogues: Requests;
  private readonly state = observable<PackManagerState>({
    installations: [],
    loaded: false,
    catalogue: { kind: 'unasked' },
    needed: new Map(),
  });
  private following = false;

  constructor(parts: PackManagerParts) {
    this.parts = parts;
    this.availability = parts.availability;
    this.readings = new Requests(() => parts.lifetime);
    this.catalogues = new Requests(() => parts.lifetime);
  }

  readonly get = this.state.get;

  /** Starts following what is kept as the first reader arrives. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.follow();
    return this.state.subscribe(listener);
  };

  /** Why nothing can be done with packs here, or `undefined` where it can. */
  get unavailable(): string | undefined {
    return this.parts.packs === undefined ? NO_PACKS : undefined;
  }

  /** The manifest of `ref` as the installer or the catalogue knows it, where either does. */
  readonly manifestOf = (ref: PackRef): ModelPackManifest | undefined => {
    const key = packKey(ref);
    const { installations, catalogue } = this.state.get();
    const kept = installations.find((one) => packKey(one.ref) === key)?.manifest;
    if (kept !== undefined || catalogue.kind === 'unasked') return kept;
    return catalogue.packs.find((one) => packKey(refOf(one)) === key);
  };

  /** The manifest of `ref` as the catalogue offered it when last read, where it did. */
  readonly offered = (ref: PackRef): ModelPackManifest | undefined => {
    const { catalogue } = this.state.get();
    const key = packKey(ref);
    return catalogue.kind === 'unasked'
      ? undefined
      : catalogue.packs.find((one) => packKey(refOf(one)) === key);
  };

  /**
   * Fetches what the catalogue offers now. A reading replaced by a newer one
   * is given up and settles at once, leaving the catalogue to the newer one.
   */
  readonly refreshCatalogue = async (): Promise<
    DomainResult<readonly ModelPackManifest[] | undefined>
  > => {
    const { packs } = this.parts;
    if (packs === undefined) return refusedFor('model-pack.no-storage', NO_PACKS);
    this.follow();
    const signal = this.catalogues.next();
    const before = this.state.get().catalogue;
    const known = before.kind === 'unasked' ? [] : before.packs;
    this.state.update((current) => ({ ...current, catalogue: { kind: 'reading', packs: known } }));
    let read: DomainResult<readonly ModelPackManifest[]>;
    try {
      read = await packs.catalogue(await this.parts.catalogueUrl(), signal);
      signal.throwIfAborted();
    } catch (error) {
      if (signal.aborted && isAbandoned(error)) return succeed(undefined);
      throw error;
    }
    const catalogue: CatalogueReading = read.ok
      ? { kind: 'read', packs: read.value }
      : { kind: 'failed', reason: read.failures[0].summary, packs: known };
    this.state.update((current) => ({ ...current, catalogue }));
    return read;
  };

  /** Downloads and installs the version `ref` the catalogue offers. */
  readonly install = async (ref: PackRef): Promise<DomainResult<InstallState>> => {
    const { packs } = this.parts;
    if (packs === undefined) return refusedFor('model-pack.no-storage', NO_PACKS);
    const manifest = this.offered(ref);
    if (manifest === undefined) return refusedFor('model-pack.not-offered', NOT_OFFERED);
    return await this.acting(
      ref,
      async (url) => await packs.download(await url(), manifest, this.parts.lifetime),
    );
  };

  /** Resumes a paused download from what is kept. */
  readonly resume = (ref: PackRef): Promise<DomainResult<InstallState>> =>
    this.acting(
      ref,
      async (url, packs) => await packs.resume(await url(), ref, this.parts.lifetime),
    );

  /** Tries a failed download again, from what is kept where its failure allows. */
  readonly retry = (ref: PackRef): Promise<DomainResult<InstallState>> =>
    this.acting(
      ref,
      async (url, packs) => await packs.retry(await url(), ref, this.parts.lifetime),
    );

  /** Pauses a download in flight, or one waiting its turn, keeping what arrived. */
  readonly pause = (ref: PackRef): Promise<DomainResult<void>> =>
    this.acting(ref, (_url, packs) => packs.pause(ref));

  /** Gives up a download, queued, paused or failed, and deletes what is kept of it. */
  readonly cancel = (ref: PackRef): Promise<DomainResult<InstallState>> =>
    this.acting(ref, (_url, packs) => packs.cancel(ref));

  /**
   * Removes an installed or failed version; one a project needs only
   * `knowingly`, and where it is refused for that, keeps the reason to offer
   * it.
   */
  readonly remove = async (
    ref: PackRef,
    knowingly: boolean,
  ): Promise<DomainResult<InstallState>> => {
    const removed = await this.acting(ref, (_url, packs) => packs.remove(ref, knowingly));
    if (!removed.ok && removed.failures[0].code === VERSION_PINNED) {
      const why = removed.failures[0].summary;
      this.state.update((current) => ({
        ...current,
        needed: new Map(current.needed).set(packKey(ref), why),
      }));
    }
    return removed;
  };

  /**
   * Installs the version a pack's folder the person chooses holds, or settles
   * with nothing where they dismiss the chooser. The chooser is opened first,
   * in the person's gesture, as a browser asks.
   */
  readonly importFolder = async (): Promise<DomainResult<PackImport | undefined>> => {
    const { packs } = this.parts;
    if (packs === undefined) return refusedFor('model-pack.no-storage', NO_PACKS);
    const folder = await this.parts.chooseFolder();
    if (folder === undefined) return succeed(undefined);
    this.follow();
    return await packs.importFolder(folder, this.parts.lifetime);
  };

  /**
   * Runs one step on the version `ref`, forgetting any refusal kept of it
   * first, since the person has moved on from it.
   */
  private async acting<TValue>(
    ref: PackRef,
    step: (url: () => Promise<string>, packs: PacksClient) => Promise<DomainResult<TValue>>,
  ): Promise<DomainResult<TValue>> {
    const { packs } = this.parts;
    if (packs === undefined) return refusedFor('model-pack.no-storage', NO_PACKS);
    this.follow();
    this.forgetNeed(packKey(ref));
    return await step(this.parts.catalogueUrl, packs);
  }

  private forgetNeed(key: string): void {
    if (!this.state.get().needed.has(key)) return;
    this.state.update((current) => {
      const needed = new Map(current.needed);
      needed.delete(key);
      return { ...current, needed };
    });
  }

  /** Reads what is kept and follows each change of it, once, for the page's life. */
  private follow(): void {
    const { packs, lifetime } = this.parts;
    if (this.following || packs === undefined || lifetime.aborted) return;
    this.following = true;
    const stop = packs.listen(this.changed);
    lifetime.addEventListener('abort', stop, { once: true });
    void this.read();
  }

  /** Reads every version the installer knows of, in place of the list held. */
  private async read(): Promise<void> {
    const { packs } = this.parts;
    if (packs === undefined) return;
    const signal = this.readings.next();
    let read: DomainResult<readonly Installation[]>;
    try {
      read = await packs.installations(signal);
      signal.throwIfAborted();
    } catch (error) {
      // Given up for a newer reading, or as the page goes; any other is a
      // fault of the worker, said as the reason the list could not be read.
      if (signal.aborted && isAbandoned(error)) return;
      const problem = error instanceof Error ? error.message : String(error);
      this.state.update((current) => ({ ...current, problem }));
      return;
    }
    if (!read.ok) {
      const problem = `The model packs kept here could not be read: ${read.failures[0].summary}`;
      this.state.update((current) => ({ ...current, problem }));
      return;
    }
    const fresh = read.value;
    this.state.update((current) => {
      const installations = this.keptInPlace(current.installations, fresh);
      if (
        current.loaded &&
        current.problem === undefined &&
        installations === current.installations
      ) {
        return current;
      }
      const { problem: _read, ...rest } = current;
      return { ...rest, installations, loaded: true };
    });
  }

  /**
   * `fresh`, each version whose manifest and state are as held kept as the
   * value it was, and the list held where nothing at all changed. Compared by
   * what each says, since every reading crosses from the worker as new values.
   */
  private keptInPlace(
    held: readonly Installation[],
    fresh: readonly Installation[],
  ): readonly Installation[] {
    const byKey = new Map(held.map((one) => [packKey(one.ref), one]));
    const kept = fresh.map((one) => {
      const was = byKey.get(packKey(one.ref));
      return was !== undefined && sameInstallation(was, one) ? was : one;
    });
    const unchanged =
      kept.length === held.length && kept.every((one, index) => one === held[index]);
    return unchanged ? held : kept;
  }

  /**
   * One version entering a state: its entry replaced where it is held, taken
   * out where it is available again, and put in its place where it is new,
   * with its manifest from the catalogue, or read with the rest where the
   * catalogue does not know it, as an import's may not.
   */
  private readonly changed = ({ ref, state }: PackChange): void => {
    const key = packKey(ref);
    if (state.kind === 'available') this.forgetNeed(key);
    const current = this.state.get();
    const index = current.installations.findIndex((one) => packKey(one.ref) === key);
    const held = current.installations[index];
    if (held !== undefined) {
      const installations =
        state.kind === 'available'
          ? current.installations.toSpliced(index, 1)
          : current.installations.with(index, { ...held, state });
      this.state.set({ ...current, installations });
      return;
    }
    if (state.kind === 'available') return;
    const manifest = this.manifestOf(ref);
    if (manifest === undefined) {
      void this.read();
      return;
    }
    const installations = current.installations.toSpliced(placeOf(current.installations, key), 0, {
      ref,
      manifest,
      state,
    });
    this.state.set({ ...current, installations });
  };
}
