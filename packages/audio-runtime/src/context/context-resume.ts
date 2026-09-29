/**
 * Resuming an audio context without waiting on the browser for ever.
 *
 * A browser does not refuse a resume made without a click or a key press: it
 * keeps the promise pending until the page has one, perhaps never, and the
 * Web Audio specification says so. So a resume is waited on for
 * {@link GESTURE_WAIT_MILLISECONDS} at most. It ends when the context runs,
 * which its `statechange` may say before the promise settles, when the
 * browser answers, or when the wait runs out; a resume the wait outlasts
 * stays with the browser, which completes it at the next click or key press.
 */

import { fail, failure, FailureKind, type DomainResult } from '@audiogubbins/domain';

import { AudioContextState, type AudioContextPort } from './audio-context-port.js';
import { isDomException } from './dom-exception.js';
import type { Schedule } from '../schedule.js';

/**
 * How long a resume is waited on. A browser that allows the start answers
 * within the time the device takes to open, and waking an output such as a
 * Bluetooth headset can take over a second; one that does not answers never.
 */
export const GESTURE_WAIT_MILLISECONDS = 2_000;

/** How a resume ended, or where it stood when the wait ran out. */
export type ResumeOutcome =
  | { readonly kind: 'running' }
  /** Still suspended, with a resume the browser holds until the page is clicked. */
  | { readonly kind: 'awaiting-gesture' }
  /** Asked to run, but held by the system, as Safari holds an interrupted context. */
  | { readonly kind: 'held'; readonly state: AudioContextState }
  /** Refused, by a context closed or on a page no longer shown. */
  | { readonly kind: 'refused'; readonly reason: string };

/** Where a context stands once asked to run: running, or held by the system. */
function standing(port: AudioContextPort): ResumeOutcome {
  return port.state === AudioContextState.Running
    ? { kind: 'running' }
    : { kind: 'held', state: port.state };
}

/** How the wait on a resume ended: with an outcome, or with a fault to rethrow. */
type Settled = ResumeOutcome | { readonly kind: 'fault'; readonly error: unknown };

/** Resumes `port`, settling with the first of its running, the browser's answer and the wait's end. */
function settle(port: AudioContextPort, schedule: Schedule): Promise<Settled> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: Settled): void => {
      if (settled) return;
      settled = true;
      cancelWait();
      port.removeEventListener('statechange', onStateChange);
      resolve(outcome);
    };
    const onStateChange = (): void => {
      if (port.state === AudioContextState.Running) finish({ kind: 'running' });
    };
    port.addEventListener('statechange', onStateChange);
    const cancelWait = schedule(() => {
      finish(
        port.state === AudioContextState.Suspended ? { kind: 'awaiting-gesture' } : standing(port),
      );
    }, GESTURE_WAIT_MILLISECONDS);
    void port.resume().then(
      () => {
        finish(standing(port));
      },
      (error: unknown) => {
        // A closed context, or one whose page is no longer shown, refuses
        // (InvalidStateError), and so does a pending resume that the
        // context's suspension or closing cancels. Anything else is a fault:
        // it ends the wait, or, once nothing waits, surfaces unhandled rather
        // than vanishing.
        if (isDomException(error, 'InvalidStateError')) {
          finish({ kind: 'refused', reason: error.message });
          return;
        }
        if (settled) throw error;
        finish({ kind: 'fault', error });
      },
    );
  });
}

/** Resumes `port`, settling with the first of its running, the browser's answer and the wait's end. */
export async function resumeWithin(
  port: AudioContextPort,
  schedule: Schedule,
): Promise<ResumeOutcome> {
  const settled = await settle(port, schedule);
  if (settled.kind === 'fault') throw settled.error;
  return settled;
}

/** What the person is told of a resume that did not end running. */
export function resumeFailure(
  outcome: Exclude<ResumeOutcome, { readonly kind: 'running' }>,
): DomainResult<never> {
  switch (outcome.kind) {
    case 'awaiting-gesture':
      return fail(
        failure(
          'audio.context-awaiting-gesture',
          FailureKind.Retryable,
          'Audio is waiting for a click or a key press on the page, which the browser needs ' +
            'before it starts audio; it starts at the next one.',
        ),
      );
    case 'held':
      return fail(
        failure(
          'audio.context-not-running',
          FailureKind.Retryable,
          'The browser accepted the request to start audio, but the system is holding the ' +
            'output device; playback starts when it is released.',
          { details: { state: outcome.state } },
        ),
      );
    case 'refused':
      return fail(
        failure(
          'audio.context-resume-refused',
          FailureKind.Retryable,
          'The browser would not start audio because the audio context has closed. Press Play ' +
            'to start a new one.',
          { details: { reason: outcome.reason } },
        ),
      );
  }
}
