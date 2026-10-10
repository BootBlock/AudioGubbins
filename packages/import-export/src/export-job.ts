/**
 * One export as a state machine (ADR-0092, REQ-ARCH-153).
 *
 * `planned`, `rendering`, `encoding`, `staged`, `delivering`, `delivered`, and
 * `failed` or `cancelled` from any state before `delivered`. Rendering is the
 * canonical render with the encoder taking its blocks as they come, and the
 * staged bytes growing with them; encoding is the encoder finishing once the
 * render has, completing a head that depends on the whole stream; staged is the
 * whole encoded file in the staging area. A delivery refused, for permission or
 * a collision, returns to `staged` with the reason, so the person can retry or
 * choose another destination without a new render.
 *
 * The workers do the work and report it as events; this says whether each
 * report can be so, and refuses one that cannot, such as frames going
 * backwards, a render finishing short, or a delivery before staging.
 */

import { fail, succeed, type DomainFailure, type DomainResult } from '@audiogubbins/domain';

import { conflict } from './refusal.js';

/** Where a delivered file went: the kind of destination, and the name it was written as. */
export interface DeliveryTarget {
  readonly kind: 'file' | 'folder' | 'trusted-folder' | 'download';
  readonly name: string;
}

/** The encoded file in the staging area. */
export interface StagedFile {
  readonly bytes: number;

  /** Its SHA-256, in hexadecimal, which a trusted folder's later exports are checked against. */
  readonly hash: string;

  /** Whether the codec gives the same bytes on every machine. */
  readonly reproducible: boolean;
}

/** A state before `delivered`, which a failure or a cancellation is from. */
export type ExportStage = 'planned' | 'rendering' | 'encoding' | 'staged' | 'delivering';

/** Where an export is. */
export type ExportJobState =
  | { readonly kind: 'planned' }
  | { readonly kind: 'rendering'; readonly framesRendered: number; readonly bytesStaged: number }
  | { readonly kind: 'encoding'; readonly bytesStaged: number }
  | {
      readonly kind: 'staged';
      readonly staged: StagedFile;
      /** Why the last delivery was refused, if one was. */
      readonly refused: DomainFailure | undefined;
    }
  | {
      readonly kind: 'delivering';
      readonly staged: StagedFile;
      readonly target: DeliveryTarget;
      readonly bytesDelivered: number;
    }
  | { readonly kind: 'delivered'; readonly staged: StagedFile; readonly target: DeliveryTarget }
  | { readonly kind: 'failed'; readonly stage: ExportStage; readonly failure: DomainFailure }
  | { readonly kind: 'cancelled'; readonly stage: ExportStage };

/** One export: the frames it renders, and where it is. */
export interface ExportJob {
  readonly id: string;
  readonly framesTotal: number;
  readonly state: ExportJobState;
}

/** What the workers and the person report of an export. */
export type ExportJobEvent =
  | { readonly kind: 'render-started' }
  /** The frames rendered so far, and the bytes staged so far. */
  | { readonly kind: 'progress'; readonly framesRendered: number; readonly bytesStaged: number }
  | { readonly kind: 'render-finished' }
  | { readonly kind: 'staged'; readonly staged: StagedFile }
  | { readonly kind: 'delivery-started'; readonly target: DeliveryTarget }
  | { readonly kind: 'delivery-progress'; readonly bytesDelivered: number }
  | { readonly kind: 'delivered' }
  | { readonly kind: 'delivery-refused'; readonly failure: DomainFailure }
  | { readonly kind: 'failed'; readonly failure: DomainFailure }
  | { readonly kind: 'cancel' };

/** A job about to render `framesTotal` frames. */
export function plannedExport(id: string, framesTotal: number): ExportJob {
  return { id, framesTotal, state: { kind: 'planned' } };
}

function refused(job: ExportJob, event: ExportJobEvent, why: string): DomainResult<never> {
  return fail(
    conflict(
      'export-step-refused',
      `An export that is ${job.state.kind} cannot take "${event.kind}": ${why}`,
    ),
  );
}

function moved(job: ExportJob, state: ExportJobState): DomainResult<ExportJob> {
  return succeed({ ...job, state });
}

/** Whether a job is past every state a failure or a cancellation is from. */
function finished(
  state: ExportJobState,
): state is Extract<ExportJobState, { kind: 'delivered' | 'failed' | 'cancelled' }> {
  return state.kind === 'delivered' || state.kind === 'failed' || state.kind === 'cancelled';
}

function progressed(
  job: ExportJob,
  event: Extract<ExportJobEvent, { kind: 'progress' }>,
): DomainResult<ExportJob> {
  const { state } = job;
  if (state.kind !== 'rendering') return refused(job, event, 'only a render reports its frames.');
  const { framesRendered, bytesStaged } = event;
  if (framesRendered < state.framesRendered || framesRendered > job.framesTotal) {
    return refused(
      job,
      event,
      `frames rendered run from 0 to ${String(job.framesTotal)}, never back.`,
    );
  }
  if (bytesStaged < state.bytesStaged) return refused(job, event, 'staged bytes never shrink.');
  return moved(job, { kind: 'rendering', framesRendered, bytesStaged });
}

function renderFinished(job: ExportJob, event: ExportJobEvent): DomainResult<ExportJob> {
  const { state } = job;
  if (state.kind !== 'rendering') return refused(job, event, 'only a render finishes rendering.');
  if (state.framesRendered !== job.framesTotal) {
    return refused(
      job,
      event,
      `the render reached ${String(state.framesRendered)} of ${String(job.framesTotal)} frames.`,
    );
  }
  return moved(job, { kind: 'encoding', bytesStaged: state.bytesStaged });
}

function staged(
  job: ExportJob,
  event: Extract<ExportJobEvent, { kind: 'staged' }>,
): DomainResult<ExportJob> {
  const { state } = job;
  if (state.kind !== 'encoding')
    return refused(job, event, 'a file is staged once its encoding finishes.');
  if (event.staged.bytes < state.bytesStaged) {
    return refused(job, event, 'the staged file is smaller than the bytes already staged.');
  }
  return moved(job, { kind: 'staged', staged: event.staged, refused: undefined });
}

function delivering(job: ExportJob, event: ExportJobEvent): DomainResult<ExportJob> {
  const { state } = job;
  switch (event.kind) {
    case 'delivery-started':
      return state.kind === 'staged'
        ? moved(job, {
            kind: 'delivering',
            staged: state.staged,
            target: event.target,
            bytesDelivered: 0,
          })
        : refused(job, event, 'only a staged file is delivered.');
    case 'delivery-progress':
      return state.kind === 'delivering' &&
        event.bytesDelivered >= state.bytesDelivered &&
        event.bytesDelivered <= state.staged.bytes
        ? moved(job, { ...state, bytesDelivered: event.bytesDelivered })
        : refused(
            job,
            event,
            "delivered bytes grow, up to the staged file's size, while delivering.",
          );
    case 'delivered':
      return state.kind === 'delivering' && state.bytesDelivered === state.staged.bytes
        ? moved(job, { kind: 'delivered', staged: state.staged, target: state.target })
        : refused(job, event, 'a file is delivered whole, after every byte is written.');
    case 'delivery-refused':
      return state.kind === 'delivering'
        ? moved(job, { kind: 'staged', staged: state.staged, refused: event.failure })
        : refused(job, event, 'only a delivery under way is refused.');
    default:
      return refused(job, event, 'it is not a delivery step.');
  }
}

/** The job after `event`, or why the job cannot take it. */
export function nextExportJob(job: ExportJob, event: ExportJobEvent): DomainResult<ExportJob> {
  const { state } = job;
  switch (event.kind) {
    case 'render-started':
      return state.kind === 'planned'
        ? moved(job, { kind: 'rendering', framesRendered: 0, bytesStaged: 0 })
        : refused(job, event, 'a job renders once.');
    case 'progress':
      return progressed(job, event);
    case 'render-finished':
      return renderFinished(job, event);
    case 'staged':
      return staged(job, event);
    case 'failed':
      return finished(state)
        ? refused(job, event, 'the export has already ended.')
        : moved(job, { kind: 'failed', stage: state.kind, failure: event.failure });
    case 'cancel':
      return finished(state)
        ? refused(job, event, 'the export has already ended.')
        : moved(job, { kind: 'cancelled', stage: state.kind });
    default:
      return delivering(job, event);
  }
}
