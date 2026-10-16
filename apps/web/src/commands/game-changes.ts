/**
 * How the game commands change the project (ADR-0101): through its game
 * commands, as one step one undo reverses, saying what came of it once it
 * settles, the project's own refusal among it; and a value of the policy as
 * those commands take it, the project document's own canonical JSON, which the
 * Inspector's editors, the commands and the workflows give alike.
 */

import type { CommandInvocation } from '@audiogubbins/commands';
import type { PolicyField, PolicyValues } from '@audiogubbins/game-audio';
import { canonicalJson, writePolicyValue } from '@audiogubbins/project-format';

import type { GameScope } from './game-target.js';
import { sayWhenSettled } from './project-access.js';
import type { ShellContext } from './shell-context.js';

/**
 * Runs `invocations` on the project as one step called `description`, saying
 * `said` once it is made, or the project's reason it was not, and then
 * `applied` where it was.
 */
export function changeGame(
  context: ShellContext,
  scope: Pick<GameScope, 'session'>,
  change: {
    readonly description: string;
    readonly invocations: readonly [CommandInvocation, ...CommandInvocation[]];
    readonly said: string;
    readonly applied?: () => void;
  },
): void {
  const [first, ...rest] = change.invocations;
  const work =
    rest.length === 0
      ? scope.session.run(first)
      : scope.session.runGroup(change.description, [first, ...rest]);
  sayWhenSettled(context, work, (outcome) => {
    if (outcome.kind !== 'applied') return outcome.reason;
    change.applied?.();
    return change.said;
  });
}

/**
 * `value` of `field` as the policy commands take it, the project document's
 * own canonical JSON, which the Inspector's editors and the workflows give.
 */
export function policyValueArgument<F extends PolicyField>(
  field: F,
  value: PolicyValues[F],
): string {
  return canonicalJson(writePolicyValue(field, value));
}
