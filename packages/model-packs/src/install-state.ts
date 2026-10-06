/**
 * The life of one installation of a pack version, as a state machine
 * (REQ-ARCH-153, ADR-0062).
 *
 * A pure reducer: a state and an event give the next state, or the reason the
 * state cannot take the event. Nothing here waits, reads or writes; the
 * installer performs the work and states what happened as events, so every rule
 * of the lifecycle is in one table and tested without any I/O.
 *
 * - `available`: nothing of the version is kept.
 * - `downloading`: its files are arriving; `received` of `total` bytes are
 *   kept.
 * - `paused`: arrival has stopped and what was received is kept for a resume.
 * - `verifying`: every file has arrived and is being checked against its hash.
 * - `installed`: every file was checked, and the version may be used.
 * - `failed`: the reason, and whether a retry resumes from `received` or starts
 *   again.
 * - `removing`: what is kept of the version is being deleted.
 *
 * Whether an update is available, and whether the version runs on this runtime,
 * are conditions stated beside the state (`availability.ts`), never states: an
 * installed pack with a newer version published is still installed.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';

/** The states of an installation (see the module comment). */
export type InstallState =
  | { readonly kind: 'available' }
  | { readonly kind: 'downloading'; readonly received: number; readonly total: number }
  | { readonly kind: 'paused'; readonly received: number; readonly total: number }
  | { readonly kind: 'verifying'; readonly total: number }
  | { readonly kind: 'installed' }
  | {
      readonly kind: 'failed';
      readonly reason: DomainFailure;
      /** Whether a retry continues from `received`; false starts again from nothing. */
      readonly resumable: boolean;
      /** The bytes kept that a retry continues from: none where it cannot. */
      readonly received: number;
    }
  | { readonly kind: 'removing' };

/**
 * What happens to an installation.
 *
 * - `start`: a download begins, finding `received` of `total` bytes kept from
 *   before.
 * - `progress`: `received` bytes are now kept.
 * - `pause`: arrival stops, keeping what came.
 * - `resume`: arrival starts again, finding `received` bytes kept.
 * - `downloaded`: every byte has arrived; checking begins.
 * - `verified`: every file matched its hash.
 * - `fail`: the work failed for `reason`; `resumable` where what was kept may
 *   be continued from.
 * - `retry`: a failed installation starts again, of `total` bytes, finding
 *   `received` kept: none where its failure was not resumable.
 * - `damaged`: an installed version's files were found not to match.
 * - `cancel`: a download, paused or not, or a failure, is given up, and what
 *   was kept is to be deleted.
 * - `remove`: an installed or failed version is to be deleted.
 * - `removed`: the deletion is done.
 */
export type InstallEvent =
  | { readonly kind: 'start'; readonly received: number; readonly total: number }
  | { readonly kind: 'progress'; readonly received: number }
  | { readonly kind: 'pause' }
  | { readonly kind: 'resume'; readonly received: number }
  | { readonly kind: 'downloaded' }
  | { readonly kind: 'verified' }
  | { readonly kind: 'fail'; readonly reason: DomainFailure; readonly resumable: boolean }
  | { readonly kind: 'retry'; readonly received: number; readonly total: number }
  | { readonly kind: 'damaged'; readonly reason: DomainFailure }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'remove' }
  | { readonly kind: 'removed' };

/** The state of a version nothing is known of. */
export const AVAILABLE: InstallState = { kind: 'available' };

/** Why a state cannot take an event. */
function refused(state: InstallState, event: InstallEvent, why: string): DomainResult<never> {
  return fail(
    failure(
      'model-pack.transition-refused',
      FailureKind.Conflict,
      `A pack that is ${state.kind} cannot take ${event.kind}: ${why}`,
      { details: { state: state.kind, event: event.kind } },
    ),
  );
}

/** Whether `received` bytes may be kept of `total`. */
function isProgress(received: number, total: number): boolean {
  return Number.isSafeInteger(received) && received >= 0 && received <= total;
}

/** The next state, or why `state` cannot take `event`. */
export function nextInstallState(
  state: InstallState,
  event: InstallEvent,
): DomainResult<InstallState> {
  switch (event.kind) {
    case 'start':
      if (state.kind !== 'available') {
        return refused(state, event, 'only a pack not yet kept starts a download.');
      }
      if (!Number.isSafeInteger(event.total) || event.total < 1) {
        return refused(state, event, 'a download transfers one byte at least.');
      }
      return isProgress(event.received, event.total)
        ? succeed({ kind: 'downloading', received: event.received, total: event.total })
        : refused(state, event, 'what is kept lies between nothing and the whole download.');

    case 'progress':
      if (state.kind !== 'downloading') {
        return refused(state, event, 'only a download makes progress.');
      }
      return isProgress(event.received, state.total) && event.received >= state.received
        ? succeed({ ...state, received: event.received })
        : refused(state, event, 'what is kept only grows, and never past the whole download.');

    case 'pause':
      return state.kind === 'downloading'
        ? succeed({ kind: 'paused', received: state.received, total: state.total })
        : refused(state, event, 'only a download pauses.');

    case 'resume':
      if (state.kind !== 'paused') return refused(state, event, 'only a paused download resumes.');
      return isProgress(event.received, state.total)
        ? succeed({ kind: 'downloading', received: event.received, total: state.total })
        : refused(state, event, 'what is kept lies between nothing and the whole download.');

    case 'downloaded':
      if (state.kind !== 'downloading') {
        return refused(state, event, 'only a download finishes downloading.');
      }
      return state.received === state.total
        ? succeed({ kind: 'verifying', total: state.total })
        : refused(state, event, 'bytes of the download have not arrived.');

    case 'verified':
      return state.kind === 'verifying'
        ? succeed({ kind: 'installed' })
        : refused(state, event, 'only a pack being checked is found whole.');

    case 'fail':
      switch (state.kind) {
        case 'downloading':
          return succeed({
            kind: 'failed',
            reason: event.reason,
            resumable: event.resumable,
            received: event.resumable ? state.received : 0,
          });
        // A check that fails keeps nothing it checked, and a removal that
        // fails has kept part of the files, so neither can be resumed from.
        case 'verifying':
        case 'removing':
          return succeed(unresumable(event.reason));
        default:
          return refused(state, event, 'only a download, a check or a removal fails.');
      }

    case 'retry':
      if (state.kind !== 'failed') return refused(state, event, 'only a failure is retried.');
      if (!Number.isSafeInteger(event.total) || event.total < 1) {
        return refused(state, event, 'a download transfers one byte at least.');
      }
      if (!state.resumable && event.received !== 0) {
        return refused(state, event, 'a failure that cannot be resumed from starts from nothing.');
      }
      return isProgress(event.received, event.total)
        ? succeed({ kind: 'downloading', received: event.received, total: event.total })
        : refused(state, event, 'what is kept lies between nothing and the whole download.');

    case 'damaged':
      return state.kind === 'installed'
        ? succeed(unresumable(event.reason))
        : refused(state, event, 'only an installed pack is found damaged.');

    case 'cancel':
      return state.kind === 'downloading' || state.kind === 'paused' || state.kind === 'failed'
        ? succeed({ kind: 'removing' })
        : refused(state, event, 'only a download or a failure is cancelled.');

    case 'remove':
      return state.kind === 'installed' || state.kind === 'failed'
        ? succeed({ kind: 'removing' })
        : refused(state, event, 'only an installed or failed pack is removed.');

    case 'removed':
      return state.kind === 'removing'
        ? succeed(AVAILABLE)
        : refused(state, event, 'only a pack being removed is removed.');
  }
}

/** A failure that a retry starts again from nothing. */
function unresumable(reason: DomainFailure): InstallState {
  return { kind: 'failed', reason, resumable: false, received: 0 };
}
