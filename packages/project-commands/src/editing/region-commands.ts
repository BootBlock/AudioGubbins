/**
 * Adding, changing and removing regions, and applying and withdrawing a
 * region's own processing (REQ-EDIT-014, ADR-0051).
 *
 * A region's properties (its name, boundaries, loop and tags) are set whole by
 * one command whose inverse sets them back; its rack is set by the rack command
 * alone (`rack-commands.ts`); its processing is a chain like an asset's,
 * applied at the end and withdrawn from the end. Every command keeps an inverse
 * short enough to journal whatever the region holds: a region is removed only
 * once its processing is withdrawn, which the interface does in the same
 * change, so no inverse carries more than one chain, which the domain bounds. A
 * chain a region names enters and leaves with it as `chain-naming.ts` says. A
 * change to a region's processing anywhere but at its end, such as a split's,
 * is made the same way, as one change of those steps (`region-invocations.ts`),
 * each re-applied step giving its chain whole, since withdrawing it may have
 * removed the chain.
 */

import {
  CommandCategory,
  refusal,
  unchanged,
  type CommandInvocation,
  type CommandOutcome,
} from '@audiogubbins/commands';
import {
  FailureKind,
  fail,
  failure,
  validateRegion,
  type DomainResult,
  type Region,
} from '@audiogubbins/domain';
import {
  canonicalJson,
  isJsonObject,
  readRegion,
  readRegionOperation,
  writeRegion,
  type JsonValue,
  type ProjectState,
} from '@audiogubbins/project-format';

import { jsonArgument, readNested, refusedBy } from '../invocation-arguments.js';
import {
  NO_PROVENANCE,
  ProjectCommandId,
  applied,
  projectCommand,
  type ProjectCommand,
} from '../project-command.js';
import { rackChainOf, stateNaming, withoutUnnamed } from '../processing/chain-naming.js';
import { idArgument, targetRegion } from './editing-arguments.js';
import {
  KEPT_BY_THE_REGION,
  addRegionInvocation,
  applyRegionEditInvocation,
  removeRegionInvocation,
  setRegionInvocation,
  withdrawRegionEditInvocation,
} from './region-invocations.js';
import { regionEditDescription } from './edit-descriptions.js';
import { withRegion, withoutRegion } from './editing-state.js';
import { quoted } from '@audiogubbins/text';

/** The commands that change regions and their processing. */
export function regionCommands(): readonly ProjectCommand[] {
  const declare = (
    id: ProjectCommand['id'],
    label: string,
    description: string,
    run: (state: ProjectState, invocation: CommandInvocation) => CommandOutcome<ProjectState>,
  ): ProjectCommand =>
    projectCommand({
      id,
      label,
      category: CommandCategory.Edit,
      description,
      run,
      provenance: NO_PROVENANCE,
    });
  return [
    declare(
      ProjectCommandId.AddRegion,
      'Add a region',
      'Adds a region to one of the project’s assets.',
      addRegion,
    ),
    declare(
      ProjectCommandId.SetRegion,
      'Change a region',
      'Sets a region’s name, boundaries, loop and tags.',
      setRegion,
    ),
    declare(
      ProjectCommandId.RemoveRegion,
      'Remove a region',
      'Removes a region whose processing is withdrawn.',
      removeRegion,
    ),
    declare(
      ProjectCommandId.ApplyRegionEdit,
      'Process a region',
      'Adds processing to the end of a region’s own chain.',
      applyRegionEdit,
    ),
    declare(
      ProjectCommandId.WithdrawRegionEdit,
      'Withdraw a region’s processing',
      'Removes the last processing of a region’s chain.',
      withdrawRegionEdit,
    ),
  ];
}

function rejected(code: string, summary: string): DomainResult<never> {
  return fail(failure(code, FailureKind.Rejected, summary));
}

/** The region as it would stand, checked on its asset. */
function standing(state: ProjectState, region: Region): DomainResult<Region> {
  const asset = state.project.assets.get(region.assetId);
  return asset === undefined
    ? rejected('region.asset-unknown', 'The project has no asset for this region.')
    : validateRegion(asset, region, state.project.effectChains);
}

/** The region the argument `region` holds. */
function regionArgument(invocation: CommandInvocation): DomainResult<Region> {
  const value = jsonArgument(invocation, 'region');
  return value.ok ? readNested(readRegion, value.value, '') : value;
}

function addRegion(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const read = regionArgument(invocation);
  const naming = read.ok ? stateNaming(state, invocation, read.value.rack) : read;
  if (!naming.ok) return refusedBy(naming);
  const region = read.ok ? standing(naming.value, read.value) : read;
  if (!region.ok) return refusedBy(region);
  if (state.project.regions.has(region.value.id)) {
    return refusal('region.duplicate-id', 'The project already has a region with that identifier.');
  }
  if (region.value.operations.length > 0) {
    return refusal(
      'region.added-with-processing',
      'A region is added without processing, and its processing is applied after it.',
    );
  }
  return applied(
    withRegion(naming.value, region.value),
    removeRegionInvocation(region.value),
    `Add region ${quoted(region.value.displayName)}`,
  );
}

/**
 * The region the argument `region` sets: its properties as given over the
 * region as it stands, keeping its identity, its asset and its processing.
 */
function setRegion(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const old = targetRegion(state, invocation);
  if (!old.ok) return refusedBy(old);
  const properties = jsonArgument(invocation, 'region');
  if (!properties.ok) return refusedBy(properties);
  const value = properties.value;
  if (!isJsonObject(value)) {
    return refusal(
      'region.properties-malformed',
      'A region’s properties must be given as an object.',
    );
  }
  const kept = writeRegion(old.value);
  const merged: JsonValue = {
    ...Object.fromEntries(Object.entries(value).filter(([key]) => !KEPT_BY_THE_REGION.has(key))),
    ...Object.fromEntries(Object.entries(kept).filter(([key]) => KEPT_BY_THE_REGION.has(key))),
  };
  const read = readNested(readRegion, merged, '');
  const region = read.ok ? standing(state, read.value) : read;
  if (!region.ok) return refusedBy(region);
  if (canonicalJson(writeRegion(region.value)) === canonicalJson(kept)) {
    return unchanged('region.unchanged', 'The region is already as given.');
  }
  return applied(
    withRegion(state, region.value),
    setRegionInvocation(old.value),
    `Change region ${quoted(region.value.displayName)}`,
  );
}

function removeRegion(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const region = targetRegion(state, invocation);
  if (!region.ok) return refusedBy(region);
  if (region.value.operations.length > 0) {
    return refusal(
      'region.has-processing',
      `Region ${quoted(region.value.displayName)} still has processing; withdraw it before removing the region.`,
    );
  }
  const next = withoutUnnamed(withoutRegion(state, region.value.id), region.value.rack);
  return applied(
    next.state,
    addRegionInvocation(region.value, next.removed),
    `Remove region ${quoted(region.value.displayName)}`,
  );
}

function applyRegionEdit(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const region = targetRegion(state, invocation);
  if (!region.ok) return refusedBy(region);
  const value = jsonArgument(invocation, 'operation');
  if (!value.ok) return refusedBy(value);
  const operation = readNested(readRegionOperation, value.value, '');
  if (!operation.ok) return refusedBy(operation);
  if (region.value.operations.some((existing) => existing.id === operation.value.id)) {
    return refusal(
      'region.duplicate-operation',
      'The region already has processing with that identifier.',
    );
  }
  const naming = stateNaming(state, invocation, rackChainOf(operation.value));
  if (!naming.ok) return refusedBy(naming);
  const next = standing(naming.value, {
    ...region.value,
    operations: [...region.value.operations, operation.value],
  });
  if (!next.ok) return refusedBy(next);
  return applied(
    withRegion(naming.value, next.value),
    withdrawRegionEditInvocation(region.value, operation.value),
    regionEditDescription(operation.value.edit, region.value.displayName),
  );
}

function withdrawRegionEdit(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const region = targetRegion(state, invocation);
  if (!region.ok) return refusedBy(region);
  const id = idArgument<'EditOperationId'>(invocation, 'operationId');
  if (!id.ok) return refusedBy(id);
  const last = region.value.operations.at(-1);
  if (last?.id !== id.value) {
    return refusal(
      'region.not-last',
      `Only the last processing of ${quoted(region.value.displayName)} can be withdrawn.`,
    );
  }
  const next = withoutUnnamed(
    withRegion(state, { ...region.value, operations: region.value.operations.slice(0, -1) }),
    rackChainOf(last),
  );
  return applied(
    next.state,
    applyRegionEditInvocation(region.value, last, next.removed),
    `Withdraw: ${regionEditDescription(last.edit, region.value.displayName)}`,
  );
}
