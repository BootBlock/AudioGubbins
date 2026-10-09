/**
 * Adding, removing and naming a project's assets (REQ-STOR-026, REQ-STOR-102,
 * REQ-PROD-056, REQ-EDIT-073).
 *
 * An asset comes with its source, so the two are added and removed together and
 * the aggregate never holds one without the other. Removing an asset takes it
 * out of the current state and nothing more: its bytes stay in the media store
 * while any retained state, the history among them, still reaches them, and
 * only an explicit purge reclaims them (REQ-STOR-102). The inverse of a removal
 * carries the whole record, so undo needs nothing the history lacks: with the
 * chain of the asset's rack, where nothing else names it and it went with the
 * asset (`chain-naming.ts`).
 */

import {
  CommandCategory,
  refusal,
  unchanged,
  type CommandInvocation,
  type CommandOutcome,
} from '@audiogubbins/commands';
import { assetUsers, type Asset } from '@audiogubbins/domain';
import {
  ProvenanceArgument,
  givenName,
  readAssetRecord,
  writtenName,
  type ProjectState,
} from '@audiogubbins/project-format';
import { counted, quoted } from '@audiogubbins/text';

import {
  jsonArgument,
  readNested,
  refusedBy,
  targetAsset,
  textArgument,
} from './invocation-arguments.js';
import {
  NO_PROVENANCE,
  ProjectCommandId,
  applied,
  assetAvailability,
  projectCommand,
  type ProjectCommand,
} from './project-command.js';
import { stateNaming, withoutUnnamed } from './processing/chain-naming.js';
import { addAssetInvocation } from './project-invocations.js';
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
      run: (state, invocation) => renameAsset(state, invocation, givenName),
      provenance: NO_PROVENANCE,
    }),
    projectCommand({
      id: ProjectCommandId.SetAssetName,
      label: 'Set an asset name',
      category: CommandCategory.Edit,
      description:
        'Sets an asset name exactly as given, which is how undo restores the name it had.',
      availability: assetAvailability,
      run: (state, invocation) => renameAsset(state, invocation, writtenName),
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
  if (asset.edits.length > 0) {
    return refusal(
      'asset.added-with-edits',
      'An asset is added unedited, and its edits are applied after it.',
    );
  }
  const naming = stateNaming(state, invocation, asset.rack);
  if (!naming.ok) return refusedBy(naming);
  if (asset.rack !== undefined && !naming.value.project.effectChains.has(asset.rack)) {
    return refusal(
      'asset.rack-unknown',
      'The asset’s rack names a chain the project does not have.',
    );
  }
  return applied(
    withAsset(naming.value, asset, source),
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

  const users = usersOf(state, asset);
  if (users !== undefined) {
    return refusal(
      'asset.in-use',
      `${quoted(asset.displayName)} still has ${users}. Remove them first.`,
    );
  }
  const next = withoutUnnamed(withoutAsset(state, asset.id), asset.rack);
  return applied(
    next.state,
    addAssetInvocation(asset, source, next.removed),
    `Remove asset ${quoted(asset.displayName)}`,
  );
}

function renameAsset(
  state: ProjectState,
  invocation: CommandInvocation,
  rule: typeof givenName,
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

/**
 * What still names the asset or rests on it, as a sentence lists it, or
 * `undefined` where nothing does. Its edits count: an asset is removed
 * unedited, so its inverse never carries its edits (ADR-0051).
 */
function usersOf(state: ProjectState, asset: Asset): string | undefined {
  const users = assetUsers(state.project, asset.id);
  const parts = (
    [
      [users.clips, 'clip that plays it', 'clips that play it'],
      [users.regions, 'region', 'regions'],
      [users.markers, 'marker', 'markers'],
      [users.pastes, 'asset with audio pasted from it', 'assets with audio pasted from it'],
      [users.takes, 'take that is its recording', 'takes that are its recording'],
      [asset.edits.length, 'edit', 'edits'],
    ] as const
  )
    .filter(([count]) => count > 0)
    .map(([count, one, many]) => counted(count, one, many));
  if (parts.length === 0) return undefined;
  const last = parts.pop();
  return parts.length === 0 ? last : `${parts.join(', ')} and ${String(last)}`;
}
