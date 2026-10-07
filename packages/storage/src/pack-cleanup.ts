/**
 * What a storage cleanup does with model packs (REQ-AUDIO-139, REQ-STOR-102,
 * REQ-STOR-106): what it offers and plans of them, and their removal as
 * planned, checked again against the store as it is by then.
 *
 * A version not installed (arriving, paused, left by a session cut short, or
 * unreadable) is never used, so it is planned as safe to remove, losing only
 * the download's progress; the cleanup removes it with the storage-wide lock
 * held alone, which a transfer shares while it writes (`model-pack-store.ts`).
 * An installed version is listed for the person to choose, and planned only
 * where they chose it; one a project needs, as the installer's pins say, is
 * never planned, and the listing says why it is kept, as it does for every
 * version where the pins cannot be read. A removal reads the pins again, and
 * keeps, and reports, a version a project has come to need since the plan.
 *
 * Every removal goes through the installer, the one authority on a version's
 * install state (REQ-ARCH-153): a partial version is cancelled and an
 * installed one removed with the pins as its retention, so the installer's
 * state machine sees each removal as it happens, refuses one while another
 * operation runs on the version, and never goes on holding as installed a
 * version a cleanup has deleted, to find it missing on its next read.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';
import {
  VERSION_BUSY,
  VERSION_PINNED,
  packKey,
  type PackInstaller,
  type PackRef,
} from '@audiogubbins/model-packs';

import type { MeasuredPack, ModelPackStore } from './model-pack-store.js';

/** A model pack version a step removes: its name, where its manifest gives one, and its bytes. */
export interface PlannedPack {
  readonly ref: PackRef;
  readonly name?: string;
  readonly bytes: number;
}

/** Why a cleanup keeps an installed pack rather than offer it. */
export type PackKept =
  /** A project needs the version: the installer's pins hold it until it is removed knowingly. */
  | 'needed'
  /** Which versions projects need cannot be told now, so this one might be. */
  | 'needs-unknown';

/** An installed pack as a plan lists it: offered to be chosen, or kept and why. */
export interface InstalledPack {
  readonly ref: PackRef;
  readonly name: string;
  readonly bytes: number;

  /** Why no cleanup removes it, where none will; absent where the person may choose it. */
  readonly kept?: PackKept;
}

/**
 * The pack versions projects need, which no cleanup removes, as the installer
 * pins them; a failure where they cannot be told, which keeps every pack.
 */
export type PackPins = (signal?: AbortSignal) => Promise<DomainResult<readonly PackRef[]>>;

/** The steps of a plan that remove packs, and every installed pack it lists. */
export interface PackPlan {
  /** Every version not installed, where any is kept and their removal was chosen. */
  readonly downloads?: {
    readonly kind: 'pack-downloads';
    readonly packs: readonly PlannedPack[];
    readonly bytes: number;
    readonly loses: 'download-progress';
  };

  /** The installed versions the person chose, of those the plan offers. */
  readonly chosen?: {
    readonly kind: 'model-packs';
    readonly packs: readonly PlannedPack[];
    readonly bytes: number;
    readonly loses: 'model-packs';
  };
  readonly installed: readonly InstalledPack[];
}

/** What removing the chosen packs did. */
export interface ChosenRemoval {
  readonly freed: number;

  /** The versions chosen that a project came to need after the plan, kept. */
  readonly needed?: readonly PackRef[];

  /** Why none was removed: which versions projects need cannot be told. */
  readonly refused?: { readonly kind: 'needs-unknown' };
}

/**
 * Plans the packs: their downloads not finished where `downloads` asks, and
 * the installed versions `chosen` names that no project needs.
 */
export async function planPacks(
  store: ModelPackStore,
  pins: PackPins,
  downloads: boolean,
  chosen: readonly PackRef[],
  signal?: AbortSignal,
): Promise<DomainResult<PackPlan>> {
  const measured = await store.measured(signal);
  if (!measured.ok) return measured;
  const partial = measured.value.flatMap((pack) =>
    pack.kind === 'partial' ? [plannedPack(pack)] : [],
  );
  const installed = await offered(measured.value, pins, signal);
  const named = new Set(chosen.map(packKey));
  const removed = installed
    .filter((pack) => pack.kept === undefined && named.has(packKey(pack.ref)))
    .map(({ ref, name, bytes }) => ({ ref, name, bytes }));
  return succeed({
    installed,
    ...(downloads && partial.length > 0
      ? {
          downloads: {
            kind: 'pack-downloads',
            packs: partial,
            bytes: sum(partial),
            loses: 'download-progress',
          },
        }
      : {}),
    ...(removed.length > 0
      ? {
          chosen: {
            kind: 'model-packs',
            packs: removed,
            bytes: sum(removed),
            loses: 'model-packs',
          },
        }
      : {}),
  });
}

/**
 * Removes the planned downloads that are still not installed, giving the bytes
 * they held; run with the storage-wide lock held alone, so none is written.
 */
export async function removePartialPacks(
  planned: readonly PlannedPack[],
  store: ModelPackStore,
  installer: PackInstaller,
  signal?: AbortSignal,
): Promise<DomainResult<number>> {
  return await removeFound(planned, { store, installer, kind: 'partial', pins: [] }, signal);
}

/**
 * Removes the chosen packs that are still installed, keeping each a project
 * has come to need since the plan, as the pins say now, and removing none
 * where the pins cannot be read.
 */
export async function removeChosenPacks(
  planned: readonly PlannedPack[],
  store: ModelPackStore,
  installer: PackInstaller,
  pins: PackPins,
  signal?: AbortSignal,
): Promise<DomainResult<ChosenRemoval>> {
  const pinned = await pins(signal);
  if (!pinned.ok) return succeed({ freed: 0, refused: { kind: 'needs-unknown' } });
  const keys = new Set(pinned.value.map(packKey));
  const freed = await removeFound(
    planned,
    { store, installer, kind: 'installed', pins: pinned.value },
    signal,
  );
  if (!freed.ok) return freed;
  const needed = planned.flatMap(({ ref }) => (keys.has(packKey(ref)) ? [ref] : []));
  return succeed({ freed: freed.value, ...(needed.length === 0 ? {} : { needed }) });
}

/** What a removal of planned versions works with, and which versions it removes. */
interface Removal {
  readonly store: ModelPackStore;
  readonly installer: PackInstaller;
  /** The versions removed: those the store still keeps as this. */
  readonly kind: MeasuredPack['kind'];
  /** The versions projects need, which are kept. */
  readonly pins: readonly PackRef[];
}

/**
 * Removes each planned version the store still keeps as `removal.kind`, but
 * those the pins name, through the installer (see the module comment),
 * giving the bytes they held. A version another operation is running on is
 * left, and counts for nothing, as is one the installer finds pinned, which
 * the caller reports as needed by the same pins; any other refusal of the
 * installer's, or a deletion the storage refuses, fails the step with the
 * reason.
 */
async function removeFound(
  planned: readonly PlannedPack[],
  removal: Removal,
  signal?: AbortSignal,
): Promise<DomainResult<number>> {
  const { store, installer, kind, pins } = removal;
  const restored = await installer.restore();
  if (!restored.ok) return restored;
  const measured = await store.measured(signal);
  if (!measured.ok) return measured;
  const found = new Map(
    measured.value.flatMap((pack) => (pack.kind === kind ? [[packKey(pack.ref), pack]] : [])),
  );
  const kept = new Set(pins.map(packKey));
  let freed = 0;
  for (const { ref } of planned) {
    signal?.throwIfAborted();
    const pack = found.get(packKey(ref));
    if (pack === undefined || kept.has(packKey(ref))) continue;
    const removed =
      kind === 'installed'
        ? await installer.remove(pack.ref, { pinned: pins })
        : await installer.cancel(pack.ref);
    if (!removed.ok) {
      const [refusal] = removed.failures;
      // Nothing was removed, and the next cleanup finds the version again.
      if (refusal.code === VERSION_BUSY || refusal.code === VERSION_PINNED) continue;
      return fail(removalRefused(ref, refusal));
    }
    const state = removed.value;
    if (state.kind === 'failed') return fail(state.reason);
    if (state.kind === 'available') freed += pack.bytes;
  }
  return succeed(freed);
}

/**
 * Every installed version, kept where a project needs it, and every one kept
 * where which versions projects need cannot be told.
 */
async function offered(
  packs: readonly MeasuredPack[],
  pins: PackPins,
  signal?: AbortSignal,
): Promise<readonly InstalledPack[]> {
  const installed = packs.flatMap((pack) => (pack.kind === 'installed' ? [pack] : []));
  if (installed.length === 0) return [];
  const pinned = await pins(signal);
  const keys = new Set(pinned.ok ? pinned.value.map(packKey) : []);
  return installed.map(({ ref, name, bytes }) => {
    const kept: PackKept | undefined = !pinned.ok
      ? 'needs-unknown'
      : keys.has(packKey(ref))
        ? 'needed'
        : undefined;
    return { ref, name, bytes, ...(kept === undefined ? {} : { kept }) };
  });
}

/**
 * Why a cleanup stopped: the installer refused a removal for a reason other
 * than the two it expects, such as a version the installer holds in a state
 * other than the store's, which no later cleanup would mend by itself.
 */
function removalRefused(ref: PackRef, reason: DomainFailure): DomainFailure {
  return failure(
    'storage.pack-removal-refused',
    FailureKind.Conflict,
    `The cleanup could not remove ${packKey(ref)}: ${reason.summary}`,
    { details: { pack: ref.id, version: ref.version }, cause: reason },
  );
}

/** A version as a step carries it. */
function plannedPack({ ref, name, bytes }: MeasuredPack): PlannedPack {
  return { ref, bytes, ...(name === undefined ? {} : { name }) };
}

function sum(packs: readonly PlannedPack[]): number {
  return packs.reduce((total, pack) => total + pack.bytes, 0);
}
