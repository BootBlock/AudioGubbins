/**
 * What can be done about an external source that is no longer what was
 * recorded, and what its policy does without asking (REQ-STOR-053).
 *
 * The choices, in the order they are offered:
 *
 * - `adopt`: take the file now at the recorded place, where there is one.
 * - `relink`: point the source at another file; for an identical copy found
 *   elsewhere, that copy.
 * - `freeze`: play the retained copy of the version the project was made with,
 *   which is possible only where a copy was retained; otherwise it is offered
 *   as unavailable, with the reason.
 * - `keep-offline`: change nothing, and leave the asset unplayable until the
 *   source is resolved.
 *
 * What a policy applies without asking: `prompt` never applies anything, so
 * silent adoption is never the default. `adopt` applies `adopt` only to a
 * modified file, never to another file standing in the old one's place.
 * `freeze` applies `freeze` to a modified, replaced or missing file where a
 * copy was retained, and asks otherwise. An identical copy found elsewhere is
 * always offered, never applied, because relinking changes where the project
 * reads from. Nothing is applied to a file that could not be looked at for want
 * of the person's leave, since nothing is known of what became of it: giving
 * that leave may show it unchanged.
 */

import { SourceChangePolicy, type ExternalMedia } from '@audiogubbins/project-format';

import type { AbsenceReason, SourceClassification } from './source-classification.js';

/** One thing that can be done about a changed source. */
export type ResolutionKind = 'adopt' | 'relink' | 'freeze' | 'keep-offline';

/** Why a choice is offered but cannot be taken. */
export type UnavailableReason = 'no-retained-copy';

/** A choice as the interface offers it. */
export type ResolutionChoice =
  | { readonly kind: ResolutionKind; readonly available: true }
  | {
      readonly kind: ResolutionKind;
      readonly available: false;
      readonly reason: UnavailableReason;
    };

/** The choices for a source, and the one its policy takes without asking. */
export interface ResolutionPlan {
  /** Empty where there is nothing to resolve. */
  readonly choices: readonly ResolutionChoice[];
  readonly automatic?: ResolutionKind;
}

const ADOPT: ResolutionChoice = { kind: 'adopt', available: true };
const RELINK: ResolutionChoice = { kind: 'relink', available: true };
const FREEZE: ResolutionChoice = { kind: 'freeze', available: true };
const NO_FREEZE: ResolutionChoice = {
  kind: 'freeze',
  available: false,
  reason: 'no-retained-copy',
};
const KEEP_OFFLINE: ResolutionChoice = { kind: 'keep-offline', available: true };

const NOTHING_TO_RESOLVE: ResolutionPlan = { choices: [] };

/** The absences that say nothing of the file, only that it could not be read. */
const WANTING_LEAVE: ReadonlySet<AbsenceReason> = new Set<AbsenceReason>([
  'access-needed',
  'permission-refused',
]);

/** The choices for a classified source under its own policy (see the module comment). */
export function resolutionsFor(
  classification: SourceClassification,
  media: ExternalMedia,
): ResolutionPlan {
  const retained = media.retainedCopy !== undefined;
  const freeze = retained ? FREEZE : NO_FREEZE;
  const frozen = media.policy === SourceChangePolicy.Freeze && retained ? 'freeze' : undefined;

  switch (classification.kind) {
    case 'unchanged':
      return NOTHING_TO_RESOLVE;
    case 'modified':
      return planOf(
        [ADOPT, RELINK, freeze, KEEP_OFFLINE],
        media.policy === SourceChangePolicy.Adopt ? 'adopt' : frozen,
      );
    case 'replaced':
      return planOf([ADOPT, RELINK, freeze, KEEP_OFFLINE], frozen);
    case 'relinked-identical':
      return planOf([RELINK, freeze, KEEP_OFFLINE], undefined);
    case 'missing':
      return planOf(
        [RELINK, freeze, KEEP_OFFLINE],
        WANTING_LEAVE.has(classification.reason) ? undefined : frozen,
      );
  }
}

function planOf(
  choices: readonly ResolutionChoice[],
  automatic: ResolutionKind | undefined,
): ResolutionPlan {
  return automatic === undefined ? { choices } : { choices, automatic };
}
