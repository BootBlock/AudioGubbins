/**
 * Adding, removing and naming a project's assets (REQ-STOR-026, REQ-STOR-102,
 * REQ-PROD-056, REQ-EDIT-073).
 *
 * An asset comes with its source, so the two are added and removed together
 * and the aggregate never holds one without the other. Removing an asset takes
 * it out of the current state and nothing more: its bytes stay in the media
 * store while any retained state, the history among them, still reaches them,
 * and only an explicit purge reclaims them (REQ-STOR-102). The inverse of a
 * removal carries the whole record, so undo needs nothing the history lacks.
 */

import {
  CommandCategory,
  refusal,
  unchanged,
  type CommandInvocation,
  type CommandOutcome,
} from '@audiogubbins/commands';
import type { AssetId } from '@audiogubbins/domain';
import {
  ProvenanceArgument,
  canonicalJson,
  readAssetRecord,
  writeAssetRecord,
  type ProjectState,
} from '@audiogubbins/project-format';

import {
  jsonArgument,
  readNested,
  refusedBy,
  targetAsset,
  textArgument,
} from './invocation-arguments.js';
import { heldName, typedName, type NameRule } from './names.js';
import {
  NO_PROVENANCE,
  ProjectCommandId,
  applied,
  assetAvailability,
  projectCommand,
  quoted,
  type ProjectCommand,
} from './project-command.js';
import { withAsset, withAssetName, withoutAsset } from './state-edits.js';

/** The commands that add, remove and name an asset. */
export function assetCommands(): readonly ProjectCommand[] {
  return [
    projectCommand({
      id: ProjectCommandId.AddAsset,
      label: 'Add an asset',
      category: CommandCategory.Edit,
      description:
        'Adds an asset with its source to the project. The import pipeline runs this once the bytes are stored or linked.',
      run: addAsset,
      provenance: { asset: ProvenanceArgument.AssetRecord },
    }),
    projectCommand({
      id: ProjectCommandId.RemoveAsset,
      label: 'Remove an asset',
      category: CommandCategory.Edit,
      description:
        'Removes an asset no clip uses. Its audio stays stored while the history can bring it back.',
      availability: assetAvailability,
      run: removeAsset,
      provenance: NO_PROVENANCE,
    }),
    projectCommand({
      id: ProjectCommandId.RenameAsset,
      label: 'Rename an asset',
      category: CommandCategory.Edit,
      description: 'Gives an asset a new name. The name is trimmed and cannot be blank.',
      availability: assetAvailability,
      run: (state, invocation) => renameAsset(state, invocation, typedName),
      provenance: NO_PROVENANCE,
    }),
    projectCommand({
      id: ProjectCommandId.SetAssetName,
      label: 'Set an asset name',
      category: CommandCategory.Edit,
      description:
        'Sets an asset name exactly as given, which is how undo restores the name it had.',
      availability: assetAvailability,
      run: (state, invocation) => renameAsset(state, invocation, heldName),
      provenance: NO_PROVENANCE,
    }),
  ];
}

function addAsset(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const value = jsonArgument(invocation, 'asset');
  if (!value.ok) return refusedBy(value);
  const record = readNested(readAssetRecord, value.value, '');
  if (!record.ok) return refusedBy(record);

  const { asset, source } = record.value;
  const existing = state.project.assets.get(asset.id);
  if (existing !== undefined) {
    return refusal(
      'asset.duplicate-id',
      `The project already has an asset with that identifier, ${quoted(existing.displayName)}.`,
    );
  }
  return applied(
    withAsset(state, asset, source),
    { commandId: ProjectCommandId.RemoveAsset, arguments: { assetId: asset.id } },
    `Add asset ${quoted(asset.displayName)}`,
  );
}

function removeAsset(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const target = targetAsset(state, invocation);
  if (!target.ok) return refusedBy(target);
  const { asset, source } = target.value;

  const users = clipsUsing(state, asset.id);
  if (users > 0) {
    const clips = users === 1 ? '1 clip' : `${String(users)} clips`;
    return refusal(
      'asset.in-use',
      `${quoted(asset.displayName)} is used by ${clips}. Remove or change them first.`,
    );
  }
  return applied(
    withoutAsset(state, asset.id),
    {
      commandId: ProjectCommandId.AddAsset,
      arguments: { asset: canonicalJson(writeAssetRecord({ asset, source })) },
    },
    `Remove asset ${quoted(asset.displayName)}`,
  );
}

function renameAsset(
  state: ProjectState,
  invocation: CommandInvocation,
  rule: NameRule,
): CommandOutcome<ProjectState> {
  const target = targetAsset(state, invocation);
  if (!target.ok) return refusedBy(target);
  const text = textArgument(invocation, 'name');
  if (!text.ok) return refusedBy(text);
  const name = rule('asset', text.value);
  if (!name.ok) return refusedBy(name);

  const { asset } = target.value;
  const before = asset.displayName;
  if (name.value === before) {
    return unchanged('asset.name-unchanged', `The asset is already called ${quoted(before)}.`);
  }
  return applied(
    withAssetName(state, asset, name.value),
    { commandId: ProjectCommandId.SetAssetName, arguments: { assetId: asset.id, name: before } },
    `Rename asset ${quoted(before)} to ${quoted(name.value)}`,
  );
}

/** How many clips read from the asset. */
function clipsUsing(state: ProjectState, assetId: AssetId): number {
  let count = 0;
  for (const clip of state.project.clips.values()) {
    if (clip.source.assetId === assetId) count += 1;
  }
  return count;
}
