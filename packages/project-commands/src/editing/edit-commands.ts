/**
 * Applying an edit to an asset and withdrawing it (ADR-0051).
 *
 * An asset's edits are a chain read in order, so an edit joins at the end and
 * only the last is withdrawn: the inverse of applying is withdrawing that
 * operation, and the inverse of withdrawing is applying it again, written as it
 * was. The domain's `validateOperation` decides whether an edit may join, the
 * same rule the project document is read by. One rule needs the rest of the
 * project: an edit is not withdrawn while a marker or a region is placed on the
 * timeline it made, since that would leave them placed on edits the asset no
 * longer has.
 */

import {
  CommandCategory,
  refusal,
  type CommandInvocation,
  type CommandOutcome,
} from '@audiogubbins/commands';
import { shapesOf, validateOperation, type Asset, type EditOperation } from '@audiogubbins/domain';
import {
  canonicalJson,
  readEditOperation,
  writeEditOperation,
  type ProjectState,
} from '@audiogubbins/project-format';

import { jsonArgument, readNested, refusedBy, targetAsset } from '../invocation-arguments.js';
import {
  NO_PROVENANCE,
  ProjectCommandId,
  applied,
  assetAvailability,
  projectCommand,
  type ProjectCommand,
} from '../project-command.js';
import { idArgument } from './editing-arguments.js';
import { withAssetEdits } from './editing-state.js';
import { editDescription } from './edit-descriptions.js';
import { quoted } from '@audiogubbins/text';

/** The commands that apply and withdraw an asset's edits. */
export function editCommands(): readonly ProjectCommand[] {
  return [
    projectCommand({
      id: ProjectCommandId.ApplyEdit,
      label: 'Apply an edit',
      category: CommandCategory.Edit,
      description: 'Adds an edit to the end of an asset’s chain, leaving its source unchanged.',
      availability: assetAvailability,
      run: applyEdit,
      provenance: NO_PROVENANCE,
    }),
    projectCommand({
      id: ProjectCommandId.WithdrawEdit,
      label: 'Withdraw an edit',
      category: CommandCategory.Edit,
      description: 'Removes the last edit of an asset’s chain.',
      availability: assetAvailability,
      run: withdrawEdit,
      provenance: NO_PROVENANCE,
    }),
  ];
}

/** Whether anything is placed on the timeline the asset's last edit made. */
function placedOnLast(state: ProjectState, asset: Asset): boolean {
  const last = asset.edits.length;
  const regions = [...state.project.regions.values()].filter(
    (region) => region.assetId === asset.id,
  );
  return (
    [...state.project.markers.values()].some(
      (marker) => marker.assetId === asset.id && marker.basis === last,
    ) ||
    regions.some(
      (region) =>
        region.basis === last ||
        region.loop?.basis === last ||
        region.operations.some((operation) => operation.basis === last),
    )
  );
}

function applyEdit(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const target = targetAsset(state, invocation);
  if (!target.ok) return refusedBy(target);
  const { asset } = target.value;
  const value = jsonArgument(invocation, 'operation');
  if (!value.ok) return refusedBy(value);
  const operation = readNested(readEditOperation, value.value, '');
  if (!operation.ok) return refusedBy(operation);
  if (asset.edits.some((existing) => existing.id === operation.value.id)) {
    return refusal(
      'edit.duplicate-id',
      `${quoted(asset.displayName)} already has an edit with that identifier.`,
    );
  }
  const shape = shapesOf(asset).at(-1);
  if (shape === undefined) throw new Error('A chain always has a shape.');
  const valid = validateOperation(
    operation.value,
    shape,
    state.project.assets,
    state.project.effectChains,
  );
  if (!valid.ok) return refusedBy(valid);
  return applied(
    withAssetEdits(state, asset, [...asset.edits, operation.value]),
    withdrawInvocation(asset, operation.value),
    editDescription(operation.value, asset.displayName),
  );
}

function withdrawEdit(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const target = targetAsset(state, invocation);
  if (!target.ok) return refusedBy(target);
  const { asset } = target.value;
  const id = idArgument<'EditOperationId'>(invocation, 'operationId');
  if (!id.ok) return refusedBy(id);
  const last = asset.edits.at(-1);
  if (last?.id !== id.value) {
    return refusal(
      'edit.not-last',
      `Only the last edit of ${quoted(asset.displayName)} can be withdrawn.`,
    );
  }
  if (placedOnLast(state, asset)) {
    return refusal(
      'edit.placed-after',
      `A marker or region of ${quoted(asset.displayName)} was placed after this edit; remove or move it first.`,
    );
  }
  return applied(
    withAssetEdits(state, asset, asset.edits.slice(0, -1)),
    applyInvocation(asset, last),
    `Withdraw: ${editDescription(last, asset.displayName)}`,
  );
}

/** Applies `operation` to the end of the asset's chain. */
export function applyInvocation(
  asset: Pick<Asset, 'id'>,
  operation: EditOperation,
): CommandInvocation {
  return {
    commandId: ProjectCommandId.ApplyEdit,
    arguments: { assetId: asset.id, operation: canonicalJson(writeEditOperation(operation)) },
  };
}

/** Withdraws `operation`, the last of the asset's chain. */
export function withdrawInvocation(
  asset: Pick<Asset, 'id'>,
  operation: EditOperation,
): CommandInvocation {
  return {
    commandId: ProjectCommandId.WithdrawEdit,
    arguments: { assetId: asset.id, operationId: operation.id },
  };
}
