/**
 * Making a project's backup generations as its policy says, when the
 * application asks (REQ-STOR-105, REQ-STOR-106).
 *
 * The storage keeps no timer: the window writing the project ticks the
 * scheduler on its own clock, as often as it likes, with the project as it is,
 * and the scheduler decides from the policy and the history whether a
 * generation is due. A generation is made from the project as storage holds it,
 * then the policy's retention prunes the others, which the person authorised by
 * setting it, and never a protected one. Where the policy says so and the
 * person chose a backup directory, the new generation is written there as a
 * bundle too; failing to write it there is reported beside the generation made,
 * which stands whatever became of the copy. One tick at a time: a tick while
 * one runs is told the scheduler is busy.
 */

import {
  succeed,
  type DomainFailure,
  type DomainResult,
  type ProjectId,
} from '@audiogubbins/domain';
import { Turns, type ByteSink, type Digest, type StorageTree } from '@audiogubbins/project-format';

import { BackupGenerations } from './backup-generations.js';
import {
  backupDue,
  planBackupPruning,
  type BackupGeneration,
  type BackupReason,
} from './backup-planning.js';
import { writeBundle } from './bundle-writing.js';
import { CheckedRecords } from './checked-records.js';
import { readProjectCopy } from './project-copy.js';
import { ProjectFiles } from './project-files.js';
import type { ProjectModel } from './project-model.js';
import type { RecoveryServices } from './project-recovery.js';
import { refusalsReported } from './storage-failures.js';
import { whileAlone } from './storage-sharing.js';
import type { LeaseCoordinator } from './write-lease.js';
import { storedBodies, treeOfCopy, type TreeSources } from './tree-content.js';

/** The backup directory the person chose, where the platform lets them. */
export interface ExternalBackupTarget {
  /** A sink for one generation's bundle, named and placed as the target decides. */
  create(generation: {
    readonly project: ProjectId;
    readonly name: string;
    readonly number: number;
    readonly at: number;
  }): Promise<ByteSink>;
}

/** What making generations works with, each made once by the composition root. */
export interface BackupServices extends RecoveryServices, TreeSources {
  readonly tree: StorageTree;
  readonly digest: Digest;

  /** The platform's lease coordination, absent where it has none. */
  readonly coordinator?: LeaseCoordinator;
}

/** What became of the copy of a generation in the chosen backup directory. */
export type ExternalCopy =
  | { readonly kind: 'not-asked' }
  | { readonly kind: 'written' }
  | { readonly kind: 'failed'; readonly failure: DomainFailure };

/** What a tick did. */
export type BackupTick =
  | { readonly kind: 'not-due' }
  | { readonly kind: 'busy' }
  | {
      readonly kind: 'made';
      readonly generation: BackupGeneration;
      readonly pruned: readonly BackupGeneration[];
      readonly external: ExternalCopy;
    };

/** The generations of one open project (see the module comment). */
export class BackupScheduler {
  private readonly project: ProjectId;
  private readonly services: BackupServices;
  private readonly external: ExternalBackupTarget | undefined;
  private readonly generations: BackupGenerations;
  private readonly files: ProjectFiles;
  private running = false;

  /** When the newest generation was made, once it has been read. */
  private last: { readonly at: number | undefined } | undefined;

  constructor(project: ProjectId, services: BackupServices, external?: ExternalBackupTarget) {
    this.project = project;
    this.services = services;
    this.external = external;
    const records = new CheckedRecords(services.tree, services.digest);
    this.generations = new BackupGenerations(services.tree, services.digest, project);
    this.files = new ProjectFiles(records, project);
  }

  /** Makes a generation where the policy says one is due at `now`. */
  async tick(
    now: number,
    model: ProjectModel,
    signal?: AbortSignal,
  ): Promise<DomainResult<BackupTick>> {
    return await this.alone(async () => {
      const last = await this.newest(signal);
      if (!last.ok) return last;
      const reason = backupDue(model.backup, model.history, last.value, now);
      return reason === undefined
        ? succeed({ kind: 'not-due' })
        : await this.make(reason, now, model, signal);
    });
  }

  /** Makes a generation now because the person asked, protected from pruning. */
  async backUpNow(
    now: number,
    model: ProjectModel,
    signal?: AbortSignal,
  ): Promise<DomainResult<BackupTick>> {
    return await this.alone(async () => await this.make('manual', now, model, signal));
  }

  private async alone(
    work: () => Promise<DomainResult<BackupTick>>,
  ): Promise<DomainResult<BackupTick>> {
    if (this.running) return succeed({ kind: 'busy' });
    this.running = true;
    try {
      return await work();
    } finally {
      this.running = false;
    }
  }

  private async newest(signal?: AbortSignal): Promise<DomainResult<number | undefined>> {
    if (this.last !== undefined) return succeed(this.last.at);
    const listing = await this.generations.list(signal);
    if (!listing.ok) return listing;
    this.last = { at: listing.value.generations[0]?.at };
    return succeed(this.last.at);
  }

  private async make(
    reason: BackupReason,
    now: number,
    model: ProjectModel,
    signal?: AbortSignal,
  ): Promise<DomainResult<BackupTick>> {
    const copy = await readProjectCopy(this.files, this.services, signal);
    if (!copy.ok) return copy;
    const made = await this.generations.create(
      copy.value,
      { reason, at: now, protect: reason === 'manual' },
      new Turns(this.services.yieldToHost, signal),
      this.services.coordinator,
    );
    if (!made.ok) return made;
    this.last = { at: now };
    const pruned = await this.prune(model, now, signal);
    if (!pruned.ok) return pruned;
    const external = await this.copyOut(made.value, model, signal);
    return succeed({ kind: 'made', generation: made.value, pruned: pruned.value, external });
  }

  /**
   * Removes what the policy's retention no longer keeps, and what a crash left
   * incomplete: that only with the storage-wide lock held alone, and as listed
   * again under it, since a generation being written looks incomplete too.
   */
  private async prune(
    model: ProjectModel,
    now: number,
    signal?: AbortSignal,
  ): Promise<DomainResult<readonly BackupGeneration[]>> {
    const listing = await this.generations.list(signal);
    if (!listing.ok) return listing;
    const { backup } = model;
    const removed =
      backup.kind === 'automatic'
        ? planBackupPruning(listing.value.generations, backup.retention, now).removed
        : [];
    const done = await this.generations.remove(
      removed.map(({ number }) => number),
      signal,
    );
    if (!done.ok) return done;
    const abandoned = await whileAlone(
      this.services.coordinator,
      async () => {
        const again = await this.generations.list(signal);
        return again.ok ? await this.generations.remove(again.value.incomplete, signal) : again;
      },
      signal,
    );
    return abandoned.kind === 'done' && !abandoned.value.ok ? abandoned.value : succeed(removed);
  }

  /** Writes a generation into the chosen backup directory, where the policy asks. */
  private async copyOut(
    generation: BackupGeneration,
    model: ProjectModel,
    signal?: AbortSignal,
  ): Promise<ExternalCopy> {
    const { backup } = model;
    const target = this.external;
    if (target === undefined || backup.kind !== 'automatic' || backup.external !== true) {
      return { kind: 'not-asked' };
    }
    const copy = await this.generations.copyOf(generation.number, signal);
    const tree = copy.ok
      ? await treeOfCopy(
          copy.value,
          { scope: { kind: 'whole-history' }, includeCaches: false },
          this.services,
          signal,
        )
      : copy;
    if (!tree.ok) return { kind: 'failed', failure: tree.failures[0] };
    const written = await refusalsReported(async () => {
      const sink = await target.create({
        project: this.project,
        name: model.state.project.displayName,
        number: generation.number,
        at: generation.at,
      });
      return await writeBundle(tree.value.files, sink, {
        open: storedBodies(this.services),
        digest: this.services.digest,
        yieldToHost: this.services.yieldToHost,
        ...(signal === undefined ? {} : { signal }),
      });
    });
    return written.ok ? { kind: 'written' } : { kind: 'failed', failure: written.failures[0] };
  }
}
