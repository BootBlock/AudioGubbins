/**
 * What the installer knows of each pack version: its manifest, its state, the
 * operation running on it and the transfer in flight or the wait for a turn
 * (REQ-ARCH-153).
 *
 * A version's state changes only by an event the install state machine takes,
 * and only one operation runs on a version at a time: an operation claims the
 * version, which its state must allow, and releases it however it ends. Every
 * state a version enters is told to the listener, in order.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainFailureResult,
  type DomainResult,
} from '@audiogubbins/domain';

import {
  AVAILABLE,
  nextInstallState,
  type InstallEvent,
  type InstallState,
} from './install-state.js';
import { packKey, refOf, type ModelPackManifest, type PackRef } from './manifest.js';
import type { KeptPack } from './pack-store.js';

/** A version the installer knows of: its manifest, where it can be read, and its state. */
export interface Installation {
  readonly ref: PackRef;
  readonly manifest: ModelPackManifest | undefined;
  readonly state: InstallState;
}

/** How a transfer in flight, or a wait for a turn, was told to stop. */
export type Stop = 'pause' | 'cancel';

/** The transfer in flight on a version, or its wait for a turn to download. */
export interface Transfer {
  readonly controller: AbortController;
  stop: Stop | undefined;
}

/** What is held of a version. */
export interface Entry {
  readonly ref: PackRef;
  manifest: ModelPackManifest | undefined;
  state: InstallState;
  /** An operation is running on the version, which no other may start beside. */
  busy: boolean;
  transfer: Transfer | undefined;
}

/** The failure of an operation begun while another runs on the version. */
function busy(ref: PackRef): DomainFailureResult {
  return fail(
    failure(
      'model-pack.busy',
      FailureKind.Conflict,
      `Another operation is running on ${packKey(ref)}.`,
      { details: { pack: ref.id, version: ref.version } },
    ),
  );
}

/** The state a version the store keeps is found in. */
function foundState(pack: KeptPack): InstallState {
  switch (pack.kind) {
    case 'sealed':
      return { kind: 'installed' };
    case 'staged':
      return { kind: 'paused', received: pack.received, total: pack.manifest.downloadBytes };
    case 'damaged':
      return { kind: 'failed', reason: pack.reason, resumable: false, received: 0 };
  }
}

/** The versions the installer knows of (see the module comment). */
export class Installations {
  private readonly entries = new Map<string, Entry>();
  private readonly changed: ((ref: PackRef, state: InstallState) => void) | undefined;

  constructor(changed?: (ref: PackRef, state: InstallState) => void) {
    this.changed = changed;
  }

  /**
   * Learns the versions the store keeps, each in the state it is found in:
   * sealed is installed, staged is paused with what it received, and one that
   * cannot be read failed, to be removed. A version already known is left.
   */
  found(kept: readonly KeptPack[]): void {
    for (const pack of kept) {
      const ref = pack.kind === 'damaged' ? pack.ref : refOf(pack.manifest);
      if (this.entries.has(packKey(ref))) continue;
      this.track(ref, pack.kind === 'damaged' ? undefined : pack.manifest, foundState(pack));
    }
  }

  /** Every version known, but those available, in key order. */
  list(): readonly Installation[] {
    return [...this.entries.values()]
      .filter((entry) => entry.state.kind !== 'available')
      .sort((one, other) => (packKey(one.ref) < packKey(other.ref) ? -1 : 1))
      .map(({ ref, manifest, state }) => ({ ref, manifest, state }));
  }

  /** What is held of a version, where anything is. */
  get(ref: PackRef): Entry | undefined {
    return this.entries.get(packKey(ref));
  }

  /** What is held of a version, made available where it is new. */
  entryFor(ref: PackRef): Entry {
    return this.get(ref) ?? this.track({ id: ref.id, version: ref.version }, undefined, AVAILABLE);
  }

  /** The state of a version: available where nothing is known of it. */
  stateOf(ref: PackRef): InstallState {
    return this.get(ref)?.state ?? AVAILABLE;
  }

  /**
   * Claims a version for an operation that begins with `event`, where no other
   * runs on it and its state can take that event; the event's numbers are
   * checked again, with what the store holds, when it is applied.
   */
  claim(entry: Entry, event: InstallEvent): DomainResult<void> {
    if (entry.busy) return busy(entry.ref);
    const next = nextInstallState(entry.state, event);
    if (!next.ok) return next;
    entry.busy = true;
    return succeed(undefined);
  }

  /** Runs a claimed operation, releasing the version however it ends. */
  async run<TValue>(entry: Entry, work: () => Promise<TValue>): Promise<TValue> {
    try {
      return await work();
    } finally {
      entry.busy = false;
    }
  }

  /**
   * Moves a version to the state `event` gives. The installer sends only what a
   * claim allowed or what its work found, so a refusal here is a defect.
   */
  apply(entry: Entry, event: InstallEvent): void {
    const next = nextInstallState(entry.state, event);
    if (!next.ok) throw new Error(next.failures[0].summary);
    entry.state = next.value;
    this.changed?.(entry.ref, next.value);
  }

  private track(ref: PackRef, manifest: ModelPackManifest | undefined, state: InstallState): Entry {
    const entry: Entry = { ref, manifest, state, busy: false, transfer: undefined };
    this.entries.set(packKey(ref), entry);
    return entry;
  }
}
