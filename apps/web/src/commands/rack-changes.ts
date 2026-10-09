/**
 * How the rack commands change the project (ADR-0060, ADR-0061): through the
 * project's own rack and slot commands, which hold every rule of a chain and
 * its life, as one step one undo reverses, so a change to a chain several
 * targets name reaches all of them in that step, which is what a shared chain
 * is (REQ-EDIT-014). A rack command reads its arguments, mints identifiers,
 * runs those commands and says what came of it; it decides nothing of a chain.
 */

import type { CommandInvocation } from '@audiogubbins/commands';

import { sayWhenSettled, sessionOf } from './project-access.js';
import type { ShellContext } from './shell-context.js';

/**
 * Makes `invocations` on the open project as one change called `description`,
 * saying `said` once it is made, or why it was not; or answers why there is
 * no project to change, or nothing to do. The step is called what the person
 * did even where one project command makes it, as the history lists it.
 */
export function changeRacks(
  context: ShellContext,
  change: {
    readonly description: string;
    readonly invocations: readonly CommandInvocation[];
    readonly said: string;
  },
): string | undefined {
  const session = sessionOf(context);
  if (typeof session === 'string') return session;
  const [first, ...rest] = change.invocations;
  if (first === undefined) return 'There is nothing to change.';
  sayWhenSettled(context, session.runGroup(change.description, [first, ...rest]), (outcome) =>
    outcome.kind === 'applied' ? change.said : outcome.reason,
  );
  return undefined;
}
