/**
 * What the stored projects take, by the categories a person decides what to
 * keep by, and the cleanup that frees it (REQ-STOR-102, REQ-STOR-106,
 * REQ-STOR-200, REQ-STOR-027).
 *
 * Measuring and planning remove nothing. A plan lists its steps in the order
 * that is safest, each with what it frees and what it loses, and is carried out
 * only as it was shown: a step past the caches needs the person's confirmation
 * of the bytes those steps free, which the storage checks again. The projects
 * open in the storage worker are measured as they are, not only as they were
 * last written. After a cleanup the storage is measured again, so the figures
 * shown are the figures left. A measurement or a plan replaced by a newer one
 * is given up, since the newer one is what is shown.
 */

import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';
import type {
  CleanupPlan,
  CleanupSelection,
  StepOutcome,
  StorageUsage,
} from '@audiogubbins/storage';
import type { UsageClient } from '@audiogubbins/storage-runtime';

import { Requests, isAbandoned } from './abandoning.js';
import { observable, type Observable } from './observable.js';
import type { OpenProjectStore } from './open-project-store.js';

/** What is known of the storage, and what is being done to it. */
export interface StorageUsageState {
  /** The storage, as last measured. */
  readonly usage?: StorageUsage;

  /** A cleanup planned and waiting for the person. */
  readonly plan?: CleanupPlan;

  /** What the last cleanup did, step by step. */
  readonly outcomes?: readonly StepOutcome[];
  readonly working?: 'measuring' | 'planning' | 'cleaning';
}

/** Why there is no cleanup to carry out. */
const NOTHING_PLANNED = failure(
  'storage.cleanup-not-planned',
  FailureKind.Conflict,
  'No cleanup is planned, so nothing was removed.',
);

/** The storage's usage, and the cleanup of it. */
export class StorageUsageStore implements Observable<StorageUsageState> {
  private readonly usage: UsageClient;
  private readonly lifetime: AbortSignal;
  private readonly project: OpenProjectStore;
  private readonly measurements: Requests;
  private readonly plans: Requests;
  private readonly state = observable<StorageUsageState>({});

  /** The work under way, by its own token, so one given up clears nothing of a newer one. */
  private doing: object | undefined;

  readonly get = this.state.get;
  readonly subscribe = this.state.subscribe;

  /** The storage measured through `usage`, the store's work ending once `lifetime` aborts. */
  constructor(usage: UsageClient, lifetime: AbortSignal, project: OpenProjectStore) {
    this.usage = usage;
    this.lifetime = lifetime;
    this.project = project;
    this.measurements = new Requests(() => lifetime);
    this.plans = new Requests(() => lifetime);
  }

  /**
   * Measures the storage, the projects open taken as they are now. Given up,
   * rejecting as abandoned, once a newer measurement replaces it.
   */
  readonly measure = (): Promise<DomainResult<StorageUsage>> =>
    this.working('measuring', async () => {
      const measured = await this.usage.measure(this.measurements.next());
      if (measured.ok) this.state.update((current) => ({ ...current, usage: measured.value }));
      return measured;
    });

  /**
   * Plans a cleanup of what was chosen, removing nothing. Given up, rejecting
   * as abandoned, once a newer plan replaces it.
   */
  readonly plan = (selection: CleanupSelection): Promise<DomainResult<CleanupPlan>> =>
    this.working('planning', async () => {
      const planned = await this.usage.planCleanup(selection, this.plans.next());
      if (planned.ok) {
        this.state.update(({ outcomes: _earlier, ...rest }) => ({ ...rest, plan: planned.value }));
      }
      return planned;
    });

  /**
   * Carries the plan waiting out, with the bytes the person confirmed where any
   * step reaches past the caches, and measures the storage again after.
   */
  readonly clean = async (
    confirmedBytes?: number,
  ): Promise<DomainResult<readonly StepOutcome[]>> => {
    const { plan } = this.state.get();
    if (plan === undefined) return fail(NOTHING_PLANNED);
    const confirmation = confirmedBytes === undefined ? undefined : { bytes: confirmedBytes };
    // The project open here is cleaned through its own session, whose lease
    // any other way in would find held, by this very tab.
    const held = this.project.session();
    const ran = await this.working('cleaning', () =>
      this.usage.runCleanup(plan, confirmation, {
        ...(held === undefined ? {} : { held }),
        signal: this.lifetime,
      }),
    );
    if (!ran.ok) return ran;
    this.state.update(({ plan: _carried, ...rest }) => ({ ...rest, outcomes: ran.value }));
    await this.measure().catch((error: unknown) => {
      // A measurement the person started meanwhile shows the figures left.
      if (!isAbandoned(error)) throw error;
    });
    return succeed(ran.value);
  };

  /** Puts the plan and the last outcome away. */
  readonly dismiss = (): void => {
    this.state.update(({ plan: _plan, outcomes: _outcomes, ...rest }) => rest);
  };

  private async working<TValue>(
    doing: NonNullable<StorageUsageState['working']>,
    work: () => Promise<DomainResult<TValue>>,
  ): Promise<DomainResult<TValue>> {
    const token = {};
    this.doing = token;
    this.state.update((current) => ({ ...current, working: doing }));
    try {
      return await work();
    } finally {
      if (this.doing === token) {
        this.doing = undefined;
        this.state.update(({ working: _done, ...rest }) => rest);
      }
    }
  }
}
