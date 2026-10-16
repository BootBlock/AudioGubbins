/**
 * Adding, changing and removing regions, and applying and withdrawing a
 * region's own processing (REQ-EDIT-014, ADR-0051).
 *
 * A region's properties (its name, boundaries, loop and tags) are set whole by
 * one command, which refuses a loop it leaves without the frames its crossfade
 * reads (`validateLoopLead`), and whose inverse restores them as they were,
 * even a loop read back without those frames; its rack is set by the rack
 * command alone (`rack-commands.ts`); a region in an asset group leaves it as
 * the region is removed, and rejoins it at its place as it is added back; its
 * processing is a chain like an asset's, applied at the end and withdrawn from
 * the end. Every command keeps an inverse short enough to journal whatever the
 * region holds: a region is removed only once its processing is withdrawn,
 * which the interface does in the same change, so no inverse carries more than
 * one chain, which the domain bounds. A chain a region names enters and leaves
 * with it as `chain-naming.ts` says. A change to a region's processing anywhere
 * but at its end, such as a split's, is made the same way, as one change of
 * those steps (`region-invocations.ts`), each re-applied step giving its chain
 * whole, since withdrawing it may have removed the chain.
 */

import {
  refusal,
  unchanged,
  type CommandInvocation,
  type CommandOutcome,
} from '@audiogubbins/commands';
import {
  FailureKind,
  fail,
  failure,
  validateLoopLead,
  validateRegion,
  type Asset,
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
import { ProjectCommandId, applied, editCommand, type ProjectCommand } from '../project-command.js';
import { operationChain, stateNaming, withoutUnnamed } from '../processing/chain-naming.js';
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
import { rejoined, withoutMember } from '../game/member-removal.js';
import { quoted } from '@audiogubbins/text';

/**
 * Sets an existing region's properties back to what `region` gives, keeping
 * its processing, without asking its loop for the frames its crossfade reads:
 * how undo restores a region as it was.
 */
function restoreRegionInvocation(region: Region): CommandInvocation {
  return { ...setRegionInvocation(region), commandId: ProjectCommandId.RestoreRegion };
}

/** The commands that change regions and their processing. */
export function regionCommands(): readonly ProjectCommand[] {
  return [
    editCommand(
      ProjectCommandId.AddRegion,
      'Add a region',
      'Adds a region to one of the project’s assets.',
      addRegion,
    ),
    editCommand(
      ProjectCommandId.SetRegion,
      'Change a region',
      'Sets a region’s name, boundaries, loop and tags.',
      (state, invocation) => setRegion(state, invocation, 'checked'),
    ),
    editCommand(
      ProjectCommandId.RestoreRegion,
      'Restore a region',
      'Sets a region’s name, boundaries, loop and tags back as they were, which is how undo restores them.',
      (state, invocation) => setRegion(state, invocation, 'restored'),
    ),
    editCommand(
      ProjectCommandId.RemoveRegion,
      'Remove a region',
      'Removes a region whose processing is withdrawn, and takes it out of its asset group.',
      removeRegion,
    ),
    editCommand(
      ProjectCommandId.ApplyRegionEdit,
      'Process a region',
      'Adds processing to the end of a region’s own chain.',
      applyRegionEdit,
    ),
    editCommand(
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
  const joined = rejoined(withRegion(naming.value, region.value), invocation, {
    kind: 'region',
    region: region.value.id,
  });
  if (!joined.ok) return refusedBy(joined);
  return applied(
    joined.value,
    removeRegionInvocation(region.value),
    `Add region ${quoted(region.value.displayName)}`,
  );
}

/** The text of a region's loop, as the document writes it, or `null` where it does not loop. */
function writtenLoop(region: Region): string {
  return canonicalJson(writeRegion(region)['loop'] ?? null);
}

/**
 * Whether a change of `old` to `region` must leave its loop's crossfade the
 * frames it reads before the loop's start (`validateLoopLead`): where the loop
 * changes, or where the region's start does and the loop had them. A loop
 * read back without them, as an edit made since can leave one, is kept while
 * the change leaves the loop alone, since placing the region shortens its
 * crossfade to fit and says so.
 */
function asksLoopLead(asset: Asset, old: Region, region: Region): boolean {
  if (writtenLoop(old) !== writtenLoop(region)) return true;
  const moved = old.basis !== region.basis || old.start !== region.start;
  return moved && validateLoopLead(asset, old).ok;
}

/**
 * The region the argument `region` sets: its properties as given over the
 * region as it stands, keeping its identity, its asset and its processing.
 * Its loop's crossfade is `checked` for its lead (see {@link asksLoopLead}),
 * except where the change is undo `restored`ing the region as it was.
 */
function setRegion(
  state: ProjectState,
  invocation: CommandInvocation,
  lead: 'checked' | 'restored',
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
  const asset = state.project.assets.get(region.value.assetId);
  if (lead === 'checked' && asset !== undefined && asksLoopLead(asset, old.value, region.value)) {
    const looped = validateLoopLead(asset, region.value);
    if (!looped.ok) return refusedBy(looped);
  }
  return applied(
    withRegion(state, region.value),
    restoreRegionInvocation(old.value),
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
  const left = withoutMember(withoutRegion(state, region.value.id), {
    kind: 'region',
    region: region.value.id,
  });
  if (!left.ok) return refusedBy(left);
  const next = withoutUnnamed(left.value.state, region.value.rack);
  const restoring = addRegionInvocation(region.value, next.removed);
  return applied(
    next.state,
    { ...restoring, arguments: { ...restoring.arguments, ...left.value.rejoining } },
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
  const naming = stateNaming(state, invocation, operationChain(operation.value));
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
    operationChain(last),
  );
  return applied(
    next.state,
    applyRegionEditInvocation(region.value, last, next.removed),
    `Withdraw: ${regionEditDescription(last.edit, region.value.displayName)}`,
  );
}
