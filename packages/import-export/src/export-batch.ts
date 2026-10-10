/**
 * A batch export: a list of export jobs run one at a time, with the progress
 * of each and of the whole (ADR-0092, REQ-EDIT-014).
 *
 * A job starts only once every job before it is settled: delivered, failed,
 * cancelled, or staged with its delivery refused, which waits for the person
 * without holding up the rest. A job asking about a collision is staged with
 * no refusal and so still holds the batch, so an answer given for the rest of
 * the batch is in hand before the next job delivers. Cancelling the batch
 * cancels every job not yet ended.
 */

import { fail, succeed, type DomainResult } from '@audiogubbins/domain';

import type { CollisionAnswer } from './collision-policy.js';
import { nextExportJob, type ExportJob, type ExportJobEvent } from './export-job.js';
import { conflict } from './refusal.js';

/** The jobs of a batch, in order, and the collision answer given for the rest of it. */
export interface ExportBatch {
  readonly jobs: readonly ExportJob[];
  readonly remembered: CollisionAnswer | undefined;
}

/**
 * How far a batch has got: its jobs settled, and the frames rendered of the
 * jobs that are still to give a file, so a failed or cancelled job neither
 * fills the bar nor holds it back.
 */
export interface BatchProgress {
  readonly jobsSettled: number;
  readonly jobsTotal: number;
  readonly framesRendered: number;
  readonly framesTotal: number;
}

function ended(job: ExportJob): boolean {
  const { kind } = job.state;
  return kind === 'delivered' || kind === 'failed' || kind === 'cancelled';
}

function settled(job: ExportJob): boolean {
  return ended(job) || (job.state.kind === 'staged' && job.state.refused !== undefined);
}

function framesRendered(job: ExportJob): number {
  switch (job.state.kind) {
    case 'planned':
      return 0;
    case 'rendering':
      return job.state.framesRendered;
    default:
      return job.framesTotal;
  }
}

/** Whether a job ended without its file, whose frames the batch no longer counts on. */
function abandoned(job: ExportJob): boolean {
  return job.state.kind === 'failed' || job.state.kind === 'cancelled';
}

/** A batch of these jobs, with no answer remembered. */
export function exportBatch(jobs: readonly ExportJob[]): ExportBatch {
  return { jobs, remembered: undefined };
}

/** The job to start next, where every job before it is settled. */
export function nextJobToStart(batch: ExportBatch): ExportJob | undefined {
  for (const job of batch.jobs) {
    if (job.state.kind === 'planned') return job;
    if (!settled(job)) return undefined;
  }
  return undefined;
}

/** The batch after one of its jobs takes `event`, or why it cannot. */
export function nextExportBatch(
  batch: ExportBatch,
  jobId: string,
  event: ExportJobEvent,
): DomainResult<ExportBatch> {
  const index = batch.jobs.findIndex((job) => job.id === jobId);
  const job = batch.jobs[index];
  if (job === undefined) {
    return fail(conflict('export-job-unknown', `The batch has no export ${jobId}.`));
  }
  if (event.kind === 'render-started' && nextJobToStart(batch)?.id !== jobId) {
    return fail(
      conflict(
        'export-batch-busy',
        'An export of the batch starts only once every export before it has ended or is waiting for the person.',
      ),
    );
  }
  const next = nextExportJob(job, event);
  if (!next.ok) return next;
  return succeed({ ...batch, jobs: batch.jobs.with(index, next.value) });
}

/** The batch remembering `answer` for its remaining collisions, where the person applied it to all. */
export function rememberCollisionAnswer(
  batch: ExportBatch,
  answer: CollisionAnswer,
  applyToAll: boolean,
): ExportBatch {
  return applyToAll ? { ...batch, remembered: answer } : batch;
}

/** The batch with every job not yet ended cancelled. */
export function cancelExportBatch(batch: ExportBatch): ExportBatch {
  return {
    ...batch,
    jobs: batch.jobs.map((job) => {
      // A job that has ended refuses the cancellation and stays as it ended.
      const cancelled = nextExportJob(job, { kind: 'cancel' });
      return cancelled.ok ? cancelled.value : job;
    }),
  };
}

/** How far the batch has got, by jobs settled and by frames rendered. */
export function batchProgress(batch: ExportBatch): BatchProgress {
  const counted = batch.jobs.filter((job) => !abandoned(job));
  return {
    jobsSettled: batch.jobs.filter(settled).length,
    jobsTotal: batch.jobs.length,
    framesRendered: counted.reduce((sum, job) => sum + framesRendered(job), 0),
    framesTotal: counted.reduce((sum, job) => sum + job.framesTotal, 0),
  };
}
