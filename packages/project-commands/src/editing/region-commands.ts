/**
 * Adding, changing and removing regions, and applying and withdrawing a
 * region's own processing (REQ-EDIT-014, ADR-0051).
 *
 * A region's properties (its name, boundaries, loop and tags) are set whole by
 * one command whose inverse sets them back; its processing is a chain like an
 * asset's, applied at the end and withdrawn from the end. Every command keeps
 * an inverse short enough to journal whatever the region holds: a region is
 * removed only once its processing is withdrawn, which the interface does in
 * the same change, so no inverse carries a whole chain. A change to a region's
 * processing anywhere but at its end, such as a split's, is made the same way,
 * as one change of those steps (`changeRegionInvocations`).
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
  type RegionOperation,
} from '@audiogubbins/domain';
import {
  canonicalJson,
  isJsonObject,
  readRegion,
  readRegionOperation,
  writeRegion,
  writeRegionOperation,
  type JsonValue,
  type ProjectState,
} from '@audiogubbins/project-format';

import { jsonArgument, readNested, refusedBy } from '../invocation-arguments.js';
import {
  NO_PROVENANCE,
  ProjectCommandId,
  applied,
  projectCommand,
  quoted,
  type ProjectCommand,
} from '../project-command.js';
import { idArgument, targetRegion } from './editing-arguments.js';
import { regionEditDescription } from './edit-descriptions.js';
import { withRegion, withoutRegion } from './editing-state.js';

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

/** The members of a written region that setting its properties never changes. */
const KEPT_BY_THE_REGION: ReadonlySet<string> = new Set(['id', 'assetId', 'operations']);

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
  const region = read.ok ? standing(state, read.value) : read;
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
    withRegion(state, region.value),
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
    ...value,
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
  return applied(
    withoutRegion(state, region.value.id),
    addRegionInvocation(region.value),
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
  const next = standing(state, {
    ...region.value,
    operations: [...region.value.operations, operation.value],
  });
  if (!next.ok) return refusedBy(next);
  return applied(
    withRegion(state, next.value),
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
  return applied(
    withRegion(state, { ...region.value, operations: region.value.operations.slice(0, -1) }),
    applyRegionEditInvocation(region.value, last),
    `Withdraw: ${regionEditDescription(last.edit, region.value.displayName)}`,
  );
}

/** Adds `region`, which must have no processing yet. */
export function addRegionInvocation(region: Region): CommandInvocation {
  return {
    commandId: ProjectCommandId.AddRegion,
    arguments: { region: canonicalJson(writeRegion(region)) },
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

/**
 * Adds `region` with its processing, as the steps of one change: the region
 * without processing, then each of its operations in turn.
 */
export function addRegionWithProcessing(
  region: Region,
): readonly [CommandInvocation, ...CommandInvocation[]] {
  return [
    addRegionInvocation({ ...region, operations: [] }),
    ...region.operations.map((operation) => applyRegionEditInvocation(region, operation)),
  ];
}

function sameOperation(one: RegionOperation, other: RegionOperation): boolean {
  return canonicalJson(writeRegionOperation(one)) === canonicalJson(writeRegionOperation(other));
}

/**
 * Makes region `old` what `next` gives, as the steps of one change: its
 * properties set, its processing withdrawn from the end back to the first
 * operation `next` does not keep where it stands, and the rest of `next`'s
 * applied after. The region stays `old`'s, on `old`'s asset.
 */
export function changeRegionInvocations(
  old: Region,
  next: Region,
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
    ...into.operations.slice(kept).map((operation) => applyRegionEditInvocation(into, operation)),
  ];
}

/** Removes `region`. */
export function removeRegionInvocation(region: Pick<Region, 'id'>): CommandInvocation {
  return { commandId: ProjectCommandId.RemoveRegion, arguments: { regionId: region.id } };
}

/** Adds `operation` to the end of the region's processing. */
export function applyRegionEditInvocation(
  region: Pick<Region, 'id'>,
  operation: RegionOperation,
): CommandInvocation {
  return {
    commandId: ProjectCommandId.ApplyRegionEdit,
    arguments: { regionId: region.id, operation: canonicalJson(writeRegionOperation(operation)) },
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
