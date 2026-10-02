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

/**
 * Calls `release` once the session has written everything it holds, or has
 * stopped writing, after which nothing it holds will reach storage.
 */
export function releaseOnceSaved(session: ProjectSession, release: () => void): void {
  const settled = (): boolean => {
    const { save } = session.getSnapshot();
    return save.kind === 'saved' || save.kind === 'stopped';
  };
  if (settled()) {
    release();
    return;
  }
  const stop = session.subscribe(() => {
    if (!settled()) return;
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
