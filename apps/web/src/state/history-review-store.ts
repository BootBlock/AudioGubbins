/**
 * What the person is reviewing of the open project's history before deciding:
 * the differences between the two sides of an A/B comparison, and a compaction
 * or a retention policy planned and waiting for their confirmation
 * (REQ-STOR-195, REQ-STOR-055, REQ-STOR-106, REQ-STOR-200).
 *
 * The comparison itself is the project's, and is kept with it; what differs
 * between its sides is worked out as it is opened, so it is held here for as
 * long as that comparison stays open. A plan removes nothing: it is shown with
 * everything it would free and every capability it would take away, and only
 * the person's confirmation of that plan, bytes and all, carries it out. What
 * is held is let go whenever another project opens.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainResult,
  type ProjectId,
} from '@audiogubbins/domain';
import type {
  CompactionPlan,
  CompactionRequest,
  ComparisonSource,
  StateDifference,
} from '@audiogubbins/history';
import type { HistoryNodeId, RetentionPolicy } from '@audiogubbins/project-format';
import type { WriteOutcome } from '@audiogubbins/storage';
import type { RemoteProjectSession } from '@audiogubbins/storage-runtime';

import { observable, type Observable } from './observable.js';
import type { OpenProjectStore } from './open-project-store.js';

/** What differs between the sides of a comparison, and which sides. */
export interface ComparedDifference {
  readonly a: HistoryNodeId;
  readonly b: HistoryNodeId;
  readonly difference: StateDifference;
}

/** A compaction planned, and the retention policy it would come with, where one would. */
export interface PendingCompaction {
  readonly plan: CompactionPlan;
  readonly policy?: RetentionPolicy;
}

/** What is being reviewed. */
export interface HistoryReviewState {
  readonly difference?: ComparedDifference;
  readonly compaction?: PendingCompaction;
}

/** Why there is nothing to review in a project open to read or in none. */
const NOT_WRITABLE = failure(
  'history.not-writable',
  FailureKind.Conflict,
  'The history can be changed only in a project this tab can change.',
);

/** Why there is no plan to carry out. */
const NOTHING_PLANNED = failure(
  'history.nothing-planned',
  FailureKind.Conflict,
  'Nothing is planned to be removed from the history.',
);

/** What is being reviewed of the open project's history, and the decisions on it. */
export class HistoryReviewStore implements Observable<HistoryReviewState> {
  private readonly project: OpenProjectStore;
  private readonly state = observable<HistoryReviewState>({});
  private reviewing: ProjectId | undefined;

  readonly get = this.state.get;
  readonly subscribe = this.state.subscribe;

  constructor(project: OpenProjectStore) {
    this.project = project;
    // What is held belongs to one project, and is let go when another opens.
    project.subscribe(() => {
      const current = project.get();
      const now = current.kind === 'open' ? current.snapshot.project : undefined;
      if (now !== this.reviewing) this.state.set({});
      this.reviewing = now;
    });
  }

  /** Opens a comparison of two states and works out what differs. */
  readonly compare = (
    a: ComparisonSource,
    b: ComparisonSource,
  ): Promise<DomainResult<StateDifference>> =>
    this.withSession(async (session) => {
      const compared = await session.compare(a, b);
      if (!compared.ok) return compared;
      const { comparison } = session.getSnapshot().model;
      if (comparison !== undefined) {
        const { difference } = compared.value;
        this.state.update((current) => ({
          ...current,
          difference: { a: comparison.a.node, b: comparison.b.node, difference },
        }));
      }
      return succeed(compared.value.difference);
    });

  /** Plans a compaction of the history, removing nothing. */
  readonly planCompaction = (request: CompactionRequest): Promise<DomainResult<CompactionPlan>> =>
    this.withSession(async (session) => {
      const plan = await session.planCompaction(request);
      return plan.ok ? succeed(this.planned(plan.value)) : plan;
    });

  /** Plans what a retention policy would let go, removing nothing. */
  readonly planRetention = (policy: RetentionPolicy): Promise<DomainResult<CompactionPlan>> =>
    this.withSession(async (session) => {
      const plan = await session.planCompaction({ kind: 'policy', policy });
      return plan.ok ? succeed(this.planned(plan.value, policy)) : plan;
    });

  /** Carries out the plan waiting, as it was shown. */
  readonly confirm = (): Promise<DomainResult<WriteOutcome>> =>
    this.withSession(async (session) => {
      const pending = this.state.get().compaction;
      if (pending === undefined) return fail(NOTHING_PLANNED);
      const confirmation = { reclaimableBytes: pending.plan.reclaimableBytes };
      const done =
        pending.policy === undefined
          ? await session.compactHistory(pending.plan, confirmation)
          : await session.setRetentionPolicy(
              pending.policy,
              pending.plan.removable.length === 0 ? undefined : confirmation,
            );
      if (done.ok) this.state.update(({ compaction: _carried, ...rest }) => rest);
      return done;
    });

  /** Puts the plan waiting away, changing nothing. */
  readonly cancel = (): void => {
    this.state.update(({ compaction: _cancelled, ...rest }) => rest);
  };

  private async withSession<TValue>(
    work: (session: RemoteProjectSession) => Promise<DomainResult<TValue>>,
  ): Promise<DomainResult<TValue>> {
    const session = this.project.session();
    return session === undefined ? fail(NOT_WRITABLE) : await work(session);
  }

  /** Holds a plan for the person to decide on. */
  private planned(plan: CompactionPlan, policy?: RetentionPolicy): CompactionPlan {
    this.state.update((current) => ({
      ...current,
      compaction: policy === undefined ? { plan } : { plan, policy },
    }));
    return plan;
  }
}
