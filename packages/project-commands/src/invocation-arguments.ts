/**
 * Reading a project command's arguments, each refused with a stable code and a
 * British-English reason when it is missing or malformed.
 *
 * A replayed journal, an imported one or a macro can hold anything, so nothing
 * an invocation carries is trusted because the interface would never have sent
 * it (REQ-EDIT-073, REQ-STOR-101).
 */

import {
  FailureKind,
  fail,
  failure,
  isWellFormedId,
  succeed,
  unsafeBrandId,
  type Asset,
  type DomainFailureResult,
  type DomainResult,
} from '@audiogubbins/domain';
import { refusal, type CommandInvocation, type RefusedOutcome } from '@audiogubbins/commands';
import type { AssetSource, ProjectState } from '@audiogubbins/project-format';

/** An asset of the project with its source, as a command finds it. */
export interface TargetAsset {
  readonly asset: Asset;
  readonly source: AssetSource;
}

/** The text argument `name`, or why the invocation has none. */
export function textArgument(invocation: CommandInvocation, name: string): DomainResult<string> {
  const value = invocation.arguments?.[name];
  if (value === undefined || value === null) {
    return rejected('argument.missing', `The command needs the argument “${name}”.`);
  }
  if (typeof value !== 'string') {
    return rejected('argument.not-text', `The argument “${name}” must be text.`);
  }
  return succeed(value);
}

/**
 * The text argument `name` where it is given, `undefined` where it is absent,
 * or why it is not text.
 */
export function optionalTextArgument(
  invocation: CommandInvocation,
  name: string,
): DomainResult<string | undefined> {
  const value = invocation.arguments?.[name];
  if (value === undefined || value === null) return succeed(undefined);
  return typeof value === 'string'
    ? succeed(value)
    : rejected('argument.not-text', `The argument “${name}” must be text.`);
}

/** The asset the argument `assetId` names, with its source. */
export function targetAsset(
  state: ProjectState,
  invocation: CommandInvocation,
): DomainResult<TargetAsset> {
  const text = textArgument(invocation, 'assetId');
  if (!text.ok) return text;
  if (!isWellFormedId(text.value)) {
    return rejected('asset.id-malformed', 'The asset identifier is not one AudioGubbins makes.');
  }
  const assetId = unsafeBrandId<'AssetId'>(text.value);
  const asset = state.project.assets.get(assetId);
  const source = state.sources.get(assetId);
  if (asset === undefined || source === undefined) {
    return rejected('asset.unknown', 'The project has no asset with that identifier.');
  }
  return succeed({ asset, source });
}

/**
 * The refusal of a failed reading: the first failure's code, and every
 * failure's reason with the place in the argument it concerns.
 */
export function refusedBy(result: DomainFailureResult): RefusedOutcome {
  const [first, ...rest] = result.failures.map((problem) => {
    const at = problem.details?.['at'];
    return {
      code: problem.code,
      reason: typeof at === 'string' ? `${problem.summary} (at “${at}”)` : problem.summary,
    };
  });
  if (first === undefined) throw new Error('A failed result had no failure.');
  return refusal(first.code, first.reason, ...rest.map((problem) => problem.reason));
}

function rejected(code: string, summary: string): DomainResult<never> {
  return fail(failure(code, FailureKind.Rejected, summary));
}
