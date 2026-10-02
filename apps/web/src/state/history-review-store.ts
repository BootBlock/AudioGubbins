/**
 * What the person is reviewing of the open project's history before deciding:
 * the side of an A/B comparison they chose first, the differences between the
 * two sides of the comparison open, and a compaction or a retention policy
 * planned and waiting for their confirmation (REQ-STOR-195, REQ-STOR-055,
 * REQ-STOR-106, REQ-STOR-200).
 *
 * The comparison itself is the project's, and is kept with it; what differs
 * between its sides is worked out in the storage worker as it is opened, and
 * again whenever a comparison is open that nothing held here describes, as
 * after a reload, so the person sees what differs for as long as it stays
 * open. A plan removes nothing: it is shown with everything it would free and
 * every capability it would take away, and only the person's confirmation of
 * that plan, bytes and all, carries it out. What is held is let go whenever
 * another project opens.
 */

import type { Logger } from '@audiogubbins/diagnostics';
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
  Comparison,
  ComparisonSource,
} from '@audiogubbins/history';
import type { RetentionPolicy } from '@audiogubbins/project-format';
import type { ComparedStates, WriteOutcome } from '@audiogubbins/storage';
import type { RemoteProjectSession } from '@audiogubbins/storage-runtime';

import { isAbandoned } from './abandoning.js';
import { observable, type Observable } from './observable.js';
import type { OpenProjectStore } from './open-project-store.js';

/** A compaction planned, and the retention policy it would come with, where one would. */
export interface PendingCompaction {
  readonly plan: CompactionPlan;
  readonly policy?: RetentionPolicy;
}

/** What is being reviewed. */
export interface HistoryReviewState {
  /** The side chosen first, to compare with a side chosen next. */
  readonly chosen?: ComparisonSource;
  readonly difference?: ComparedStates;
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
  private readonly logger: Logger;
  private readonly state = observable<HistoryReviewState>({});
  private reviewing: ProjectId | undefined;

  /** The sides of the comparison whose difference is being asked for, where one is. */
  private asking: string | undefined;

  readonly get = this.state.get;
  readonly subscribe = this.state.subscribe;

  constructor(project: OpenProjectStore, logger: Logger) {
    this.project = project;
    this.logger = logger;
    // What is held belongs to one project, and is let go when another opens.
    project.subscribe(() => {
      const current = project.get();
      const now = current.kind === 'open' ? current.snapshot.project : undefined;
      if (now !== this.reviewing) {
        this.state.set({});
        this.asking = undefined;
      }
      this.reviewing = now;
      this.followComparison();
    });
  }

  /** Chooses the side to compare with a side chosen next, or puts the choice away. */
  readonly choose = (side: ComparisonSource | undefined): void => {
    this.state.update(({ chosen: _replaced, ...rest }) =>
      side === undefined ? rest : { ...rest, chosen: side },
    );
  };

  /** Opens a comparison of two states and works out what differs. */
  readonly compare = (
    a: ComparisonSource,
    b: ComparisonSource,
  ): Promise<DomainResult<ComparedStates>> =>
    this.withSession(async (session) => {
      const compared = await session.compare(a, b);
      if (!compared.ok) return compared;
      this.state.update(({ chosen: _compared, ...rest }) => ({
        ...rest,
        difference: compared.value.compared,
      }));
      return succeed(compared.value.compared);
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

  /**
   * Asks the worker what differs where a comparison is open that the difference
   * held does not describe, once for each pair of sides.
   */
  private followComparison(): void {
    const session = this.project.session();
    const comparison = session?.getSnapshot().model.comparison;
    if (session === undefined || comparison === undefined) return;
    const held = this.state.get().difference;
    const sides = sidesOf(comparison);
    if (held?.a === comparison.a.node && held.b === comparison.b.node) return;
    if (this.asking === sides) return;
    this.asking = sides;
    session.comparedDifference().then((compared) => {
      if (this.asking === sides) this.asking = undefined;
      if (!compared.ok) {
        this.logger.warning('What differs between two compared states was not worked out.', {
          code: compared.failures[0].code,
        });
        return;
      }
      const now = session.getSnapshot().model.comparison;
      if (now === undefined || sidesOf(now) !== sides) return;
      this.state.update((current) => ({ ...current, difference: compared.value }));
    }, this.logFault);
  }

  /** Logs a fault of asking, and says nothing of asking given up with the project. */
  private readonly logFault = (error: unknown): void => {
    if (isAbandoned(error)) return;
    this.logger.error('What differs between two compared states could not be asked for.', {
      reason: error instanceof Error ? error.message : 'unknown',
    });
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

/** The two sides of a comparison, as one key. */
function sidesOf(comparison: Comparison): string {
  return `${comparison.a.node} ${comparison.b.node}`;
}
