/**
 * Carrying a download, resume or retry of one pack version through to the state
 * it ends in, for the installer (`pack-installer.ts`): waiting, queued, for the
 * one turn to download (`download-slot.ts`), receiving what is missing while a
 * pause, a cancel or the caller's signal may stop it, and then checking and
 * sealing what arrived, or keeping it for a resume, or deleting it.
 *
 * Every change of the version is an event of the install state machine, sent
 * through the installer's `Installations`, so nothing here decides the
 * lifecycle. The installer makes one, and claims each version before it hands
 * the version here.
 */

import { FailureKind, succeed, type DomainFailure, type DomainResult } from '@audiogubbins/domain';

import { DownloadSlot, type ReleaseTurn } from './download-slot.js';
import type { InstallEvent, InstallState } from './install-state.js';
import type { Entry, Installations, Stop, Transfer } from './installations.js';
import { verifyKept, type Sha256 } from './integrity.js';
import { refOf, type ModelPackManifest } from './manifest.js';
import { receiveMissing, stagedTotal, type Arrival } from './pack-download.js';
import type { PackSource } from './pack-source.js';
import type { PackStore } from './pack-store.js';

/** What carrying transfers works with. */
interface TransferServices {
  readonly store: PackStore;
  readonly sha256: Sha256;
}

/** The transfers of one installer (see the module comment). */
export class PackTransfers {
  private readonly services: TransferServices;
  private readonly versions: Installations;
  private readonly slot = new DownloadSlot();

  constructor(services: TransferServices, versions: Installations) {
    this.services = services;
    this.versions = versions;
  }

  /**
   * Runs a download, resume or retry in its turn: at once with `begin`, where
   * no other pack downloads, and otherwise queued until the one downloading
   * ends, then started. Pausing or cancelling while queued leaves the queue,
   * taking no turn. The turn is given back however the transfer ends.
   */
  async inTurn(
    entry: Entry,
    manifest: ModelPackManifest,
    source: PackSource,
    signal: AbortSignal | undefined,
    begin: (received: number) => InstallEvent,
  ): Promise<DomainResult<InstallState>> {
    let release: ReleaseTurn | undefined = this.slot.tryTake();
    let starting = begin;
    if (release === undefined) {
      const staged = await stagedTotal(this.services.store, manifest);
      if (!staged.ok) return staged;
      this.versions.apply(entry, {
        kind: 'queue',
        received: staged.value,
        total: manifest.downloadBytes,
      });
      const waited = await this.stoppable(entry, signal, (stopping) => this.slot.take(stopping));
      release = waited.value;
      if (release === undefined) return await this.leftQueue(entry, waited.stop);
      starting = (received) => ({ kind: 'start', received, total: manifest.downloadBytes });
    }
    try {
      return await this.services.store.transferring(async () => {
        // Counted again in the turn, since a cleanup may have removed what a
        // queued download kept while it waited.
        const staged = await stagedTotal(this.services.store, manifest);
        if (!staged.ok) {
          if (entry.state.kind !== 'queued') return staged;
          this.versions.apply(entry, failedOn(staged.failures[0]));
          return succeed(entry.state);
        }
        this.versions.apply(entry, starting(staged.value));
        return await this.transfer(entry, manifest, source, signal);
      }, signal);
    } finally {
      release();
    }
  }

  /** Ends a wait for a turn that was stopped: cancelled, deleting what is kept, or paused. */
  private async leftQueue(
    entry: Entry,
    stop: Stop | undefined,
  ): Promise<DomainResult<InstallState>> {
    if (stop === 'cancel') {
      this.versions.apply(entry, { kind: 'cancel' });
      return await this.deleted(entry);
    }
    this.versions.apply(entry, { kind: 'pause' });
    return succeed(entry.state);
  }

  /**
   * Runs `work` as the version's stoppable work, which a pause, a cancel or
   * the caller's `signal` stops through the signal it is given, and answers
   * what it answered and how it was stopped.
   */
  private async stoppable<TValue>(
    entry: Entry,
    signal: AbortSignal | undefined,
    work: (stopping: AbortSignal) => Promise<TValue>,
  ): Promise<{ readonly value: TValue; readonly stop: Stop | undefined }> {
    const transfer: Transfer = { controller: new AbortController(), stop: undefined };
    const onAbort = (): void => {
      transfer.stop ??= 'pause';
      transfer.controller.abort();
    };
    entry.transfer = transfer;
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted === true) onAbort();
    try {
      return { value: await work(transfer.controller.signal), stop: transfer.stop };
    } finally {
      signal?.removeEventListener('abort', onAbort);
      entry.transfer = undefined;
    }
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
    const arrived = await this.stoppable(
      entry,
      signal,
      async (stopping): Promise<Arrival> =>
        await receiveMissing(
          this.services.store,
          manifest,
          source,
          entry.state.kind === 'downloading' ? entry.state.received : 0,
          (received) => {
            this.versions.apply(entry, { kind: 'progress', received });
          },
          stopping,
        ),
    );
    return await this.settled(entry, manifest, arrived.stop, arrived.value, signal);
  }

  /**
   * Ends a transfer as it was stopped or as it ended: cancelled, deleting what
   * is kept; paused; failed, resumable unless the source's file was another; or
   * arrived whole, to be checked and sealed. The check, hundreds of megabytes
   * read and hashed, is stopped by a pause, a cancel or the caller's signal as
   * the transfer was.
   */
  private async settled(
    entry: Entry,
    manifest: ModelPackManifest,
    stop: Stop | undefined,
    arrival: Arrival,
    signal: AbortSignal | undefined,
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
      this.versions.apply(entry, failedOn(arrival.result.failures[0]));
      return succeed(entry.state);
    }
    this.versions.apply(entry, { kind: 'downloaded' });
    const { store, sha256 } = this.services;
    const checking = await this.stoppable(entry, signal, async (stopping) => {
      try {
        return await verifyKept(store, manifest, sha256, stopping);
      } catch (error) {
        // The check rejects with the stopping signal's reason; anything else
        // is not a stop, and is not this code's to answer.
        if (stopping.aborted) return undefined;
        throw error;
      }
    });
    if (checking.stop === 'cancel') {
      this.versions.apply(entry, { kind: 'cancel' });
      return await this.deleted(entry);
    }
    if (checking.stop === 'pause') {
      this.versions.apply(entry, { kind: 'pause' });
      return succeed(entry.state);
    }
    const checked = checking.value;
    if (checked === undefined) throw new Error('Only a stopped check answers nothing.');
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
  async deleted(entry: Entry): Promise<DomainResult<InstallState>> {
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

/**
 * A download's failure for `reason`: resumable unless what was kept is not the
 * source's file, which nothing may continue from.
 */
function failedOn(reason: DomainFailure): InstallEvent {
  return { kind: 'fail', reason, resumable: reason.kind !== FailureKind.IntegrityViolation };
}
