/**
 * A retention policy letting history go on its own, as an open project is
 * checkpointed (REQ-STOR-055, REQ-STOR-106, REQ-STOR-200).
 *
 * The person sets a policy that lets history go only with their confirmation
 * of what it lets go then, and that policy is the authority REQ-STOR-106 asks
 * for to let go, later, what it lets go as they work. So at each checkpoint
 * the session plans what the policy lets go of the history as it is now and,
 * where that is anything, applies the plan as planned. Planning keeps what
 * every compaction keeps: the cursor and its redo line, every snapshot's point
 * and the history it stands on, and the sides of the open comparison. What is
 * let go is logged, with how much it freed.
 */

import type { Logger } from '@audiogubbins/diagnostics';
import { mapResult, succeed, type DomainResult } from '@audiogubbins/domain';
import type { CompactionPlan, CompactionRequest } from '@audiogubbins/history';
import { Turns } from '@audiogubbins/project-format';

import {
  compactedModel,
  planHistoryCompaction,
  type CompactedModel,
  type CompactionServices,
} from './history-compaction.js';
import type { ProjectModel } from './project-model.js';
import type { SessionServices } from './session-contracts.js';

/** What a policy let go: the project once it is applied, and the plan applied. */
export interface RetentionApplied {
  readonly compacted: CompactedModel;
  readonly plan: CompactionPlan;
}

/**
 * The policy of `model` applied to its history as it is now, or `undefined`
 * where it lets nothing go.
 */
export async function retentionDue(
  model: ProjectModel,
  services: Pick<SessionServices, 'files' | 'clock' | 'yieldToHost'>,
  compacting: CompactionServices,
): Promise<DomainResult<RetentionApplied | undefined>> {
  const policy = model.retention;
  if (policy.kind === 'unlimited') return succeed(undefined);
  const { files, clock, yieldToHost } = services;
  const request: CompactionRequest = { kind: 'policy', policy };
  const turns = new Turns(yieldToHost);
  const plan = await planHistoryCompaction(files, model, request, clock.now(), turns);
  if (!plan.ok) return plan;
  if (plan.value.removable.length === 0) return succeed(undefined);
  // The policy is the confirmation: the person set it, having seen what it lets go.
  const compacted = await compactedModel(model, plan.value, plan.value, compacting);
  return mapResult(compacted, (applied) => ({ compacted: applied, plan: plan.value }));
}

/** Logs what retention let go, or why it let nothing go where it failed. */
export function reportRetention(
  logger: Logger,
  done: Promise<DomainResult<CompactionPlan | undefined>>,
): void {
  done.then(
    (result) => {
      if (!result.ok) {
        logger.warning('The retention policy could not let history go.', {
          code: result.failures[0].code,
        });
      } else if (result.value !== undefined) {
        logger.info('The retention policy let older history go.', {
          count: result.value.removable.length,
          freedBytes: result.value.reclaimableBytes,
        });
      }
    },
    (error: unknown) => {
      logger.error('The retention policy failed to let history go.', {
        reason: error instanceof Error ? error.message : 'unknown',
      });
    },
  );
}
