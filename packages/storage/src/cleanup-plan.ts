/**
 * What a cleanup is made of (REQ-STOR-106, REQ-STOR-102, REQ-STOR-200,
 * REQ-STOR-027, REQ-AUDIO-139): what a person may choose, each step a plan
 * holds with what it frees and what it loses, why a step removes nothing, and
 * the plan a person confirms. Planning makes one (`cleanup-planning.ts`) and
 * running carries it out (`cleanup-running.ts`).
 */

import type { ProjectId } from '@audiogubbins/domain';
import type { CompactionPlan } from '@audiogubbins/history';
import type { CollectionPlan } from '@audiogubbins/media-store';
import type { PackRef } from '@audiogubbins/model-packs';

import type { CacheCategory } from './cache-store.js';
import type { UnreadableRoot } from './media-roots.js';
import type { InstalledPack, PlannedPack } from './pack-cleanup.js';
import type { LeftOver } from './project-leftovers.js';

/** One kind of cleanup a person may choose. */
export type CleanupChoice =
  | { readonly kind: 'cache'; readonly category: CacheCategory }
  | { readonly kind: 'pack-downloads' }
  | { readonly kind: 'unfinished-projects' }
  /** The installed model pack versions the person chose to remove. */
  | { readonly kind: 'model-packs'; readonly packs: readonly PackRef[] }
  | { readonly kind: 'expired-backups' }
  | { readonly kind: 'expired-history' }
  | { readonly kind: 'set-aside-records' }
  | { readonly kind: 'unreferenced-media' };

/** What a person chose to clean up: everything, or some of it. */
export type CleanupSelection = 'everything' | readonly CleanupChoice[];

/** What the person loses by a step, which the interface explains before they confirm. */
export type RecoverabilityLoss =
  /** Nothing: a cache is made again when it is needed. */
  | 'nothing'
  /** Only how far unfinished downloads had come, which nothing uses. */
  | 'download-progress'
  /**
   * Nothing a person kept: only projects whose making was cut short, and those
   * whose purge, which the person confirmed, was cut short.
   */
  | 'unfinished-projects'
  /** The processors that need the packs, until they are downloaded again. */
  | 'model-packs'
  /** Restoring the project to the generations removed. */
  | 'backup-generations'
  /** The history each compaction removes, as each plan lists what it loses. */
  | 'history'
  /** Looking at the changes recovery set aside. */
  | 'set-aside-changes'
  /** The media itself, which nothing refers to, for good. */
  | 'unreferenced-media';

/** One step of a cleanup, what it would free, and what it would lose. */
export type CleanupStep = {
  readonly bytes: number;
  readonly loses: RecoverabilityLoss;
} & (
  | { readonly kind: 'cache'; readonly category: CacheCategory }
  | {
      readonly kind: 'pack-downloads';

      /** Each version not installed, as the plan found it. */
      readonly packs: readonly PlannedPack[];
    }
  | {
      readonly kind: 'model-packs';

      /** Each installed version the person chose, as the plan found it. */
      readonly packs: readonly PlannedPack[];
    }
  | {
      readonly kind: 'unfinished-projects';

      /** Each project, and what the plan found a crash had left of it. */
      readonly projects: ReadonlyMap<ProjectId, LeftOver>;
    }
  | {
      readonly kind: 'expired-backups';
      readonly generations: ReadonlyMap<ProjectId, readonly number[]>;

      /** The moment each generation's age was judged at, in milliseconds since the epoch. */
      readonly at: number;
    }
  | {
      readonly kind: 'expired-history';
      readonly compactions: ReadonlyMap<ProjectId, CompactionPlan>;
    }
  | {
      readonly kind: 'set-aside-records';

      /** The names of each project's records set aside, as the plan found them. */
      readonly records: ReadonlyMap<ProjectId, readonly string[]>;
    }
  | { readonly kind: 'unreferenced-media'; readonly collection: CollectionPlan }
);

/** Why a step of a cleanup removed nothing, or media cannot be purged now. */
export type CleanupRefusal =
  | MediaRefusal
  /** Which model packs projects need cannot be told, so none is removed. */
  | { readonly kind: 'needs-unknown' };

/** Why media cannot be purged, or a step that removes left-overs removed nothing. */
export type MediaRefusal =
  /** Something that could retain media cannot be read. */
  | { readonly kind: 'unreadable'; readonly roots: readonly UnreadableRoot[] }
  /** The platform cannot keep other windows from storing media while a purge runs. */
  | { readonly kind: 'no-coordination' }
  /**
   * A window is writing what it has yet to finish, such as media it has yet to
   * refer to, a project or a backup generation, which looks left over until it
   * is whole; the cleanup may be tried again.
   */
  | { readonly kind: 'storing' };

/** A cleanup planned: its steps in the safe order, and what confirming it means. */
export interface CleanupPlan {
  readonly steps: readonly CleanupStep[];

  /**
   * The bytes the steps past the caches and the partial downloads would free:
   * what the person confirms.
   */
  readonly confirmationBytes: number;

  /** Every installed model pack, to be chosen for removal, or kept and why. */
  readonly installedPacks: readonly InstalledPack[];

  /** Why media cannot be purged, where it was chosen and cannot be. */
  readonly mediaRefused?: MediaRefusal;
}

/**
 * Whether a step removes only what is made again or never used, and so needs
 * no confirmation.
 */
export function isDisposable(step: CleanupStep): boolean {
  return step.loses === 'nothing' || step.loses === 'download-progress';
}
