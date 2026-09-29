/**
 * The failure of a playback command that only means a later one came first.
 *
 * A command awaits the context, the processor or the feeder, and the person
 * may press something else meanwhile; the one overtaken stands down with this
 * failure, and the one that overtook it reports what it did. A caller tells
 * the two apart by {@link PLAYBACK_SUPERSEDED}, and shows nothing for it.
 */

import { FailureKind, fail, failure, type DomainResult } from '@audiogubbins/domain';

/** The code of {@link superseded}'s failure, by which a caller tells a command overtaken from one refused. */
export const PLAYBACK_SUPERSEDED = 'playback.superseded';

/** A command that stood down, for the reason `summary` gives. */
export function superseded(summary: string): DomainResult<never> {
  return fail(failure(PLAYBACK_SUPERSEDED, FailureKind.Conflict, summary));
}
