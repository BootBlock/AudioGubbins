/**
 * The installer: downloads a pack version from a source into the store, checks
 * every file, and removes and updates what is kept (ADR-0062, REQ-AUDIO-139).
 *
 * Every change of an installation is an event of the install state machine,
 * which refuses what the installation's state cannot take, so the installer
 * decides nothing of the lifecycle itself: it does the work and says what
 * happened. A download keeps each run of bytes as it arrives, so a pause, a
 * failure or a restart of the application loses none of it, and a resume or a
 * retry asks the source for the rest from where the store's bytes end. A
 * version is used only once every file has been checked against its length and
 * SHA-256 and the store has sealed it; a check that fails keeps nothing of the
 * version. A file read for use is checked again as it is read.
 *
 * One file is transferred at a time, and one operation runs on a version at a
 * time; pause and cancel stop the transfer in flight. A version a project
 * needs, as the caller's pins say, is kept through an update and refused
 * removal until the person removes it knowingly.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainFailure,
  type DomainFailureResult,
  type DomainResult,
} from '@audiogubbins/domain';

import type { InstallState } from './install-state.js';
import {
  Installations,
  type Entry,
  type Installation,
  type Stop,
  type Transfer,
} from './installations.js';
import { readKept, verifyKept, type Sha256 } from './integrity.js';
import { packKey, refOf, sameRef, type ModelPackManifest, type PackRef } from './manifest.js';
import { receiveMissing, stagedTotal, type Arrival } from './pack-download.js';
import type { PackSource } from './pack-source.js';
import type { PackStore } from './pack-store.js';

/** What the installer works with. */
export interface InstallerServices {
  readonly store: PackStore;
  readonly sha256: Sha256;
  /** Told each state an installation enters, in order. */
  readonly changed?: (ref: PackRef, state: InstallState) => void;
}

/**
 * The versions projects need, which are kept until the person removes them
 * knowingly (REQ-AUDIO-139). `knowingly` says the person was told a version is
 * needed and removes it anyway.
 */
export interface Retention {
  readonly pinned: readonly PackRef[];
  readonly knowingly?: boolean;
}

function unknownManifest(ref: PackRef): DomainFailureResult {
  return fail(
    failure(
      'model-pack.manifest-unknown',
      FailureKind.Conflict,
      `The manifest of ${packKey(ref)} cannot be read, so it can only be removed.`,
      { details: { pack: ref.id, version: ref.version } },
    ),
  );
}

/** The installer (see the module comment). */
export class PackInstaller {
  private readonly services: InstallerServices;
  private readonly versions: Installations;

  constructor(services: InstallerServices) {
    this.services = services;
    this.versions = new Installations(services.changed);
  }

  /**
   * Learns what the store keeps: a sealed version is installed, a staged one
   * paused with what it received, and one that cannot be read failed, to be
   * removed. Versions the installer already knows are left as they are.
   */
  async restore(): Promise<DomainResult<void>> {
    const kept = await this.services.store.kept();
    if (!kept.ok) return kept;
    this.versions.found(kept.value);
    return succeed(undefined);
  }

  /** Every version the installer knows of, but those available, in key order. */
  installations(): readonly Installation[] {
    return this.versions.list();
  }

  /** The state of a version: available where nothing is known of it. */
  stateOf(ref: PackRef): InstallState {
    return this.versions.stateOf(ref);
  }

  /**
   * Downloads `manifest`'s version from `source`, keeps it and checks it, and
   * answers the state it ended in: installed, paused, failed or, cancelled,
   * available. Aborting `signal` pauses it. Refused where the version is not
   * available or another operation runs on it.
   */
  async download(
    manifest: ModelPackManifest,
    source: PackSource,
    signal?: AbortSignal,
  ): Promise<DomainResult<InstallState>> {
    const entry = this.versions.entryFor(refOf(manifest));
    const claimed = this.versions.claim(entry, {
      kind: 'start',
      received: 0,
      total: manifest.downloadBytes,
    });
    if (!claimed.ok) return claimed;
    return await this.versions.run(entry, async () => {
      entry.manifest = manifest;
      const staged = await stagedTotal(this.services.store, manifest);
      if (!staged.ok) return staged;
      this.versions.apply(entry, {
        kind: 'start',
        received: staged.value,
        total: manifest.downloadBytes,
      });
      return await this.transfer(entry, manifest, source, signal);
    });
  }

  /** Resumes a paused version from what is kept, as {@link download} runs. */
  async resume(
    ref: PackRef,
    source: PackSource,
    signal?: AbortSignal,
  ): Promise<DomainResult<InstallState>> {
    const entry = this.versions.entryFor(ref);
    const claimed = this.versions.claim(entry, { kind: 'resume', received: 0 });
    if (!claimed.ok) return claimed;
    return await this.versions.run(entry, async () => {
      const { manifest } = entry;
      if (manifest === undefined) return unknownManifest(ref);
      const staged = await stagedTotal(this.services.store, manifest);
      if (!staged.ok) return staged;
      this.versions.apply(entry, { kind: 'resume', received: staged.value });
      return await this.transfer(entry, manifest, source, signal);
    });
  }

  /**
   * Retries a failed version, from what is kept where the failure allows, and
   * otherwise from nothing, as {@link download} runs.
   */
  async retry(
    ref: PackRef,
    source: PackSource,
    signal?: AbortSignal,
  ): Promise<DomainResult<InstallState>> {
    const entry = this.versions.entryFor(ref);
    const { manifest } = entry;
    if (manifest === undefined) return unknownManifest(ref);
    const claimed = this.versions.claim(entry, {
      kind: 'retry',
      received: 0,
      total: manifest.downloadBytes,
    });
    if (!claimed.ok) return claimed;
    return await this.versions.run(entry, async () => {
      if (entry.state.kind === 'failed' && !entry.state.resumable) {
        const cleared = await this.services.store.remove(ref);
        if (!cleared.ok) return cleared;
      }
      const staged = await stagedTotal(this.services.store, manifest);
      if (!staged.ok) return staged;
      this.versions.apply(entry, {
        kind: 'retry',
        received: staged.value,
        total: manifest.downloadBytes,
      });
      return await this.transfer(entry, manifest, source, signal);
    });
  }

  /** Pauses a version's transfer in flight, keeping what it received. */
  pause(ref: PackRef): DomainResult<void> {
    return this.stop(ref, 'pause');
  }

  /**
   * Gives up a version being downloaded, paused or failed, and deletes what is
   * kept of it. A transfer in flight stops, and its download answers the
   * version's state once the deletion is done.
   */
  async cancel(ref: PackRef): Promise<DomainResult<InstallState>> {
    const entry = this.versions.get(ref);
    if (entry?.transfer !== undefined) {
      const stopped = this.stop(ref, 'cancel');
      return stopped.ok ? succeed(entry.state) : stopped;
    }
    const target = this.versions.entryFor(ref);
    const claimed = this.versions.claim(target, { kind: 'cancel' });
    if (!claimed.ok) return claimed;
    return await this.versions.run(target, async () => {
      this.versions.apply(target, { kind: 'cancel' });
      return await this.deleted(target);
    });
  }

  /**
   * Deletes an installed or failed version. A version `retention` pins is
   * refused unless it says the person removes it knowingly.
   */
  async remove(ref: PackRef, retention: Retention): Promise<DomainResult<InstallState>> {
    if (isPinned(ref, retention) && retention.knowingly !== true) {
      return fail(
        failure(
          'model-pack.version-pinned',
          FailureKind.Conflict,
          `A project needs ${packKey(ref)}, so it is kept until it is removed knowingly.`,
          { details: { pack: ref.id, version: ref.version } },
        ),
      );
    }
    const entry = this.versions.entryFor(ref);
    const claimed = this.versions.claim(entry, { kind: 'remove' });
    if (!claimed.ok) return claimed;
    return await this.versions.run(entry, async () => {
      this.versions.apply(entry, { kind: 'remove' });
      return await this.deleted(entry);
    });
  }

  /**
   * The whole of an installed version's file at `path`, checked against its
   * manifest as it is read. A file that no longer matches marks the version
   * damaged, so nothing uses it until it is removed and installed again.
   */
  async read(
    ref: PackRef,
    path: string,
    signal?: AbortSignal,
  ): Promise<DomainResult<Uint8Array<ArrayBuffer>>> {
    const entry = this.versions.get(ref);
    const index = entry?.manifest?.files.findIndex((file) => file.path === path) ?? -1;
    const file = entry?.manifest?.files[index];
    if (entry?.state.kind !== 'installed' || file === undefined) {
      return fail(
        failure(
          'model-pack.file-unavailable',
          FailureKind.Conflict,
          `${packKey(ref)} is not installed with a file ${path}.`,
          { details: { pack: ref.id, version: ref.version, file: path } },
        ),
      );
    }
    const read = await readKept(
      this.services.store,
      ref,
      index,
      file,
      this.services.sha256,
      signal,
    );
    if (!read.ok && read.failures[0].kind === FailureKind.IntegrityViolation) {
      // Asked again after the read, since another read may have found it first.
      if (this.versions.stateOf(ref).kind === 'installed') {
        this.versions.apply(entry, { kind: 'damaged', reason: read.failures[0] });
      }
    }
    return read;
  }

  /** Stops a transfer in flight, as a pause or a cancel. */
  private stop(ref: PackRef, how: Stop): DomainResult<void> {
    const entry = this.versions.get(ref);
    const transfer = entry?.transfer;
    if (entry === undefined || transfer === undefined) {
      return fail(
        failure(
          'model-pack.not-transferring',
          FailureKind.Conflict,
          `Nothing of ${packKey(ref)} is being transferred.`,
          { details: { pack: ref.id, version: ref.version } },
        ),
      );
    }
    // A cancel outranks a pause asked first, never the reverse.
    if (transfer.stop !== 'cancel') transfer.stop = how;
    transfer.controller.abort();
    return succeed(undefined);
  }

  /**
   * Transfers what is missing of every file, then checks and seals the version,
   * answering the state it ends in.
   */
  private async transfer(
    entry: Entry,
    manifest: ModelPackManifest,
    source: PackSource,
    signal: AbortSignal | undefined,
  ): Promise<DomainResult<InstallState>> {
    const transfer: Transfer = { controller: new AbortController(), stop: undefined };
    const onAbort = (): void => {
      transfer.stop ??= 'pause';
      transfer.controller.abort();
    };
    entry.transfer = transfer;
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted === true) onAbort();
    let arrival: Arrival;
    try {
      arrival = await receiveMissing(
        this.services.store,
        manifest,
        source,
        entry.state.kind === 'downloading' ? entry.state.received : 0,
        (received) => {
          this.versions.apply(entry, { kind: 'progress', received });
        },
        transfer.controller.signal,
      );
    } finally {
      signal?.removeEventListener('abort', onAbort);
      entry.transfer = undefined;
    }
    return await this.settled(entry, manifest, transfer.stop, arrival);
  }

  /**
   * Ends a transfer as it was stopped or as it ended: cancelled, deleting what
   * is kept; paused; failed, resumable unless the source's file was another; or
   * arrived whole, to be checked and sealed.
   */
  private async settled(
    entry: Entry,
    manifest: ModelPackManifest,
    stop: Stop | undefined,
    arrival: Arrival,
  ): Promise<DomainResult<InstallState>> {
    if (stop === 'cancel') {
      this.versions.apply(entry, { kind: 'cancel' });
      return await this.deleted(entry);
    }
    if (arrival.kind === 'stopped' || (arrival.kind === 'failed' && stop === 'pause')) {
      this.versions.apply(entry, { kind: 'pause' });
      return succeed(entry.state);
    }
    if (arrival.kind === 'failed') {
      const reason = arrival.result.failures[0];
      this.versions.apply(entry, {
        kind: 'fail',
        reason,
        resumable: reason.kind !== FailureKind.IntegrityViolation,
      });
      return succeed(entry.state);
    }
    this.versions.apply(entry, { kind: 'downloaded' });
    const { store, sha256 } = this.services;
    const checked = await verifyKept(store, manifest, sha256);
    if (!checked.ok) return await this.rejected(entry, checked.failures[0]);
    const sealed = await store.seal(refOf(manifest));
    if (!sealed.ok) return await this.rejected(entry, sealed.failures[0]);
    this.versions.apply(entry, { kind: 'verified' });
    return succeed(entry.state);
  }

  /** Fails a version being checked for `reason`, keeping nothing of it. */
  private async rejected(entry: Entry, reason: DomainFailure): Promise<DomainResult<InstallState>> {
    this.versions.apply(entry, { kind: 'fail', reason, resumable: false });
    // Where the deletion is refused too, the files stay unsealed and unused,
    // and a retry or a cancel deletes them first.
    await this.services.store.remove(entry.ref);
    return succeed(entry.state);
  }

  /** Deletes what is kept of a version being removed, and answers the state it ends in. */
  private async deleted(entry: Entry): Promise<DomainResult<InstallState>> {
    const removed = await this.services.store.remove(entry.ref);
    this.versions.apply(
      entry,
      removed.ok
        ? { kind: 'removed' }
        : { kind: 'fail', reason: removed.failures[0], resumable: false },
    );
    return succeed(entry.state);
  }
}

/** Whether `retention` pins `ref`. */
function isPinned(ref: PackRef, retention: Retention): boolean {
  return retention.pinned.some((pinned) => sameRef(pinned, ref));
}
