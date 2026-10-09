/**
 * Whether a take stack may stand in a project (ADR-0072): its takes name
 * recordings the project has, each once by its identifier, its chosen take is
 * one it keeps, and its punch, where it has one, is a range its crossfades
 * fit. A stack that punch edits name must also leave each of them standing,
 * since its chosen take is what they play.
 *
 * One rule for a command changing a stack and for a document holding one, so
 * a project that was valid as each change was made is valid when read back.
 */

import type { AssetId } from '../identity/branded-id.js';
import { AssetOrigin, type Asset } from '../project/asset.js';
import type { Project } from '../project/project.js';
import { TakeState, type PunchRange, type TakeStack } from '../project/take-stack.js';
import { punchStackOf } from '../project/take-users.js';
import { FailureKind, fail, failure, succeed, type DomainResult } from '../result.js';
import { isVersion, validateChain } from './operation-validation.js';

function refused(code: string, summary: string): DomainResult<never> {
  return fail(failure(`takes.${code}`, FailureKind.Rejected, summary));
}

/** Whether `value` is a whole number of frames from `least`. */
function isFrames(value: number, least: number): boolean {
  return Number.isSafeInteger(value) && value >= least;
}

/** Why a punch range does not hold, or `undefined` where it does. */
function punchRangeProblem(punch: PunchRange): string | undefined {
  if (!isFrames(punch.length, 1)) return 'A punch covers no whole number of frames.';
  if (!isFrames(punch.preRoll, 0) || !isFrames(punch.postRoll, 0)) {
    return 'A punch’s pre-roll and post-roll are whole numbers of frames.';
  }
  if (!isFrames(punch.crossfade.length, 0)) {
    return 'A punch’s crossfade is a whole number of frames.';
  }
  if (punch.crossfade.length * 2 > punch.length) return 'The punch’s crossfades would overlap.';
  return isVersion(punch.resampler)
    ? undefined
    : 'A punch names the version of the resampler a take at another rate is converted by.';
}

/** Why the stack's takes do not hold among `assets`, or `undefined` where they do. */
function takesProblem(stack: TakeStack, assets: ReadonlyMap<AssetId, Asset>): string | undefined {
  const seen = new Set<string>();
  for (const take of stack.takes) {
    if (seen.has(take.id)) return 'Two of the stack’s takes share an identifier.';
    seen.add(take.id);
    const recorded = assets.get(take.asset);
    if (recorded === undefined) return 'A take names a recording the project does not have.';
    if (recorded.origin !== AssetOrigin.Recorded)
      return 'A take names an asset that was not recorded.';
    if (!Number.isSafeInteger(take.compensation)) {
      return 'A take’s latency compensation is not a whole number of frames.';
    }
  }
  if (stack.chosen === undefined) return undefined;
  const chosen = stack.takes.find((take) => take.id === stack.chosen);
  if (chosen === undefined) return 'The stack’s chosen take is not one of its takes.';
  return chosen.state === TakeState.Kept
    ? undefined
    : 'A rejected or removed take cannot be the chosen one.';
}

/** The stack, where it holds by itself among the project's `assets`. */
export function validateTakeStack(
  stack: TakeStack,
  assets: ReadonlyMap<AssetId, Asset>,
): DomainResult<TakeStack> {
  const takes = takesProblem(stack, assets);
  if (takes !== undefined) return refused('stack-invalid', takes);
  const punch = stack.punch === undefined ? undefined : punchRangeProblem(stack.punch);
  return punch === undefined ? succeed(stack) : refused('punch-invalid', punch);
}

/**
 * The stack, where it holds in `project` in place of the stack of its
 * identifier: by itself, and with every punch edit that names it still
 * standing, each asset's chain checked as the document reader checks it.
 */
export function validateTakeStackInProject(
  stack: TakeStack,
  project: Project,
): DomainResult<TakeStack> {
  const valid = validateTakeStack(stack, project.assets);
  if (!valid.ok) return valid;
  const entities = {
    assets: project.assets,
    effectChains: project.effectChains,
    takeStacks: new Map(project.takeStacks).set(stack.id, stack),
  };
  for (const asset of project.assets.values()) {
    if (!asset.edits.some((operation) => punchStackOf(operation) === stack.id)) continue;
    const chain = validateChain(asset, entities);
    if (!chain.ok) return chain;
  }
  return succeed(stack);
}
