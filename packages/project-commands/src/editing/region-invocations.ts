/**
 * The invocations of the region commands (REQ-EDIT-014, ADR-0051), each built
 * with its values written as the command reads them, and the changes made of
 * several of them as one step: a region added with its processing, and a
 * region made what another gives, as a split makes its first part.
 */

import type { CommandInvocation } from '@audiogubbins/commands';
import type { EffectChain, EffectChainId, Region, RegionOperation } from '@audiogubbins/domain';
import { canonicalJson, writeRegion, writeRegionOperation } from '@audiogubbins/project-format';

import { ProjectCommandId } from '../project-command.js';
import { namingArguments, rackChainOf } from '../processing/chain-naming.js';

/**
 * The members of a written region that setting its properties never changes:
 * its identity, its asset, its processing and its rack, each changed by a
 * command of its own.
 */
export const KEPT_BY_THE_REGION: ReadonlySet<string> = new Set([
  'id',
  'assetId',
  'operations',
  'rack',
]);

/**
 * Adds `region`, which must have no processing yet; its rack's chain goes
 * with it where `chain`, the one it names, is given whole.
 */
export function addRegionInvocation(region: Region, chain?: EffectChain): CommandInvocation {
  return {
    commandId: ProjectCommandId.AddRegion,
    arguments: { region: canonicalJson(writeRegion(region)), ...namingArguments(chain) },
  };
}

/** Sets an existing region's properties as `region` gives them, keeping its processing. */
export function setRegionInvocation(region: Region): CommandInvocation {
  const properties = Object.fromEntries(
    Object.entries(writeRegion(region)).filter(([key]) => !KEPT_BY_THE_REGION.has(key)),
  );
  return {
    commandId: ProjectCommandId.SetRegion,
    arguments: { regionId: region.id, region: canonicalJson(properties) },
  };
}

/** The chains of the project, by identifier, which a step re-applied gives whole. */
export type ProjectChains = ReadonlyMap<EffectChainId, EffectChain>;

/** `operation` applied to `region`, its chain given whole from `chains` where it names one. */
function reapplied(
  region: Pick<Region, 'id'>,
  operation: RegionOperation,
  chains: ProjectChains,
): CommandInvocation {
  const chain = rackChainOf(operation);
  return applyRegionEditInvocation(
    region,
    operation,
    chain === undefined ? undefined : chains.get(chain),
  );
}

/**
 * Adds `region` with its processing, as the steps of one change: the region
 * without processing, then each of its operations in turn, every chain it
 * names given whole from `chains`, the project's as the change begins, since
 * an earlier step of the change may have removed one.
 */
export function addRegionWithProcessing(
  region: Region,
  chains: ProjectChains,
): readonly [CommandInvocation, ...CommandInvocation[]] {
  return [
    addRegionInvocation(
      { ...region, operations: [] },
      region.rack === undefined ? undefined : chains.get(region.rack),
    ),
    ...region.operations.map((operation) => reapplied(region, operation, chains)),
  ];
}

function sameOperation(one: RegionOperation, other: RegionOperation): boolean {
  return canonicalJson(writeRegionOperation(one)) === canonicalJson(writeRegionOperation(other));
}

/**
 * Makes region `old` what `next` gives, as the steps of one change: its
 * properties set, its processing withdrawn from the end back to the first
 * operation `next` does not keep where it stands, and the rest of `next`'s
 * applied after, each chain it names given whole from `chains`, the project's
 * as the change begins. The region stays `old`'s, on `old`'s asset, with
 * `old`'s rack.
 */
export function changeRegionInvocations(
  old: Region,
  next: Region,
  chains: ProjectChains,
): readonly [CommandInvocation, ...CommandInvocation[]] {
  const into: Region = { ...next, id: old.id, assetId: old.assetId };
  let kept = 0;
  for (const [index, operation] of old.operations.entries()) {
    const wanted = into.operations[index];
    if (wanted === undefined || !sameOperation(operation, wanted)) break;
    kept = index + 1;
  }
  return [
    setRegionInvocation(into),
    ...old.operations
      .slice(kept)
      .toReversed()
      .map((operation) => withdrawRegionEditInvocation(old, operation)),
    ...into.operations.slice(kept).map((operation) => reapplied(into, operation, chains)),
  ];
}

/** Removes `region`. */
export function removeRegionInvocation(region: Pick<Region, 'id'>): CommandInvocation {
  return { commandId: ProjectCommandId.RemoveRegion, arguments: { regionId: region.id } };
}

/**
 * Adds `operation` to the end of the region's processing; a rack edit's chain
 * goes with it where `chain`, the one it names, is given whole.
 */
export function applyRegionEditInvocation(
  region: Pick<Region, 'id'>,
  operation: RegionOperation,
  chain?: EffectChain,
): CommandInvocation {
  return {
    commandId: ProjectCommandId.ApplyRegionEdit,
    arguments: {
      regionId: region.id,
      operation: canonicalJson(writeRegionOperation(operation)),
      ...namingArguments(chain),
    },
  };
}

/** Withdraws `operation`, the last of the region's processing. */
export function withdrawRegionEditInvocation(
  region: Pick<Region, 'id'>,
  operation: Pick<RegionOperation, 'id'>,
): CommandInvocation {
  return {
    commandId: ProjectCommandId.WithdrawRegionEdit,
    arguments: { regionId: region.id, operationId: operation.id },
  };
}
