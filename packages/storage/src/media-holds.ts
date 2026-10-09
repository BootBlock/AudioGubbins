/**
 * Letting go of media the store holds for a change once storage holds the
 * change that refers to it (REQ-STOR-102).
 *
 * Media just stored is held, keeping every window's purge off it, since no
 * project yet refers to it. A change that refers to it is in storage only once
 * the session has written it, so the hold is let go then, or once the session
 * has stopped writing, after which nothing it holds will reach storage.
 */

import type { DomainResult } from '@audiogubbins/domain';

import type { ProjectSession } from './project-session.js';
import type { ChangeOutcome } from './session-contracts.js';

/** How the session has settled: all it holds written, or stopped writing; none yet. */
function settledAs(session: ProjectSession): 'saved' | 'stopped' | undefined {
  const { save } = session.getSnapshot();
  return save.kind === 'saved' || save.kind === 'stopped' ? save.kind : undefined;
}

/**
 * Settles once the session has written everything it holds, as `saved`, or
 * has stopped writing, as `stopped`, after which nothing it holds will reach
 * storage.
 */
export async function whenSettled(session: ProjectSession): Promise<'saved' | 'stopped'> {
  const now = settledAs(session);
  if (now !== undefined) return now;
  return await new Promise((resolve) => {
    const stop = session.subscribe(() => {
      const later = settledAs(session);
      if (later === undefined) return;
      stop();
      resolve(later);
    });
  });
}

/**
 * Calls `release` once the session has written everything it holds, or has
 * stopped writing, after which nothing it holds will reach storage.
 */
export function releaseOnceSaved(session: ProjectSession, release: () => void): void {
  if (settledAs(session) !== undefined) {
    release();
    return;
  }
  const stop = session.subscribe(() => {
    if (settledAs(session) === undefined) return;
    stop();
    release();
  });
}

/**
 * Runs `change`, the change made of media held for it, then lets the media go
 * once storage holds the change, or at once where no change was made.
 */
export async function runHolding(
  session: ProjectSession,
  release: () => void,
  change: () => Promise<DomainResult<ChangeOutcome>>,
): Promise<DomainResult<ChangeOutcome>> {
  let ran: DomainResult<ChangeOutcome> | undefined;
  try {
    ran = await change();
    return ran;
  } finally {
    if (ran?.ok === true && ran.value.kind === 'applied') releaseOnceSaved(session, release);
    else release();
  }
}
