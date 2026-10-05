/**
 * The commands that name a chain from an asset or a region (ADR-0060): giving
 * a target a rack, taking it away, and pointing a range's rack edit at
 * another chain, which is how a shared chain is made independent for one of
 * the things that name it, after the copy is added.
 *
 * A rack edit changes no time, so pointing it at another chain moves nothing
 * placed on the asset, and the edit stays where it is in the chain of edits.
 */

import {
  CommandCategory,
  refusal,
  unchanged,
  type CommandInvocation,
} from '@audiogubbins/commands';
import {
  FailureKind,
  fail,
  failure,
  isWellFormedId,
  succeed,
  type DomainResult,
  unsafeBrandId,
  type Asset,
  type EditOperation,
  type EffectChainId,
  type Region,
  type RegionOperation,
} from '@audiogubbins/domain';
import type { ProjectState } from '@audiogubbins/project-format';

import { optionalTextArgument, refusedBy, textArgument } from '../invocation-arguments.js';
import {
  NO_PROVENANCE,
  ProjectCommandId,
  applied,
  projectCommand,
  quoted,
  type ProjectCommand,
} from '../project-command.js';
import { withAssetEdits, withRegion } from '../editing/editing-state.js';

/** What a rack command acts on: an asset, or a region and its asset. */
export type RackTarget =
  | { readonly kind: 'asset'; readonly asset: Asset }
  | { readonly kind: 'region'; readonly region: Region; readonly asset: Asset };

/** The asset or region the arguments `assetId` or `regionId` name. */
function rackTarget(state: ProjectState, invocation: CommandInvocation): RackTarget | string {
  const assetText = optionalTextArgument(invocation, 'assetId');
  const regionText = optionalTextArgument(invocation, 'regionId');
  if (!assetText.ok || !regionText.ok)
    return 'An asset or a region is named by its identifier, as text.';
  if ((assetText.value === undefined) === (regionText.value === undefined)) {
    return 'The command names an asset or a region, and only one.';
  }
  const text = assetText.value ?? regionText.value ?? '';
  if (!isWellFormedId(text)) return 'The identifier is not one AudioGubbins makes.';
  if (assetText.value !== undefined) {
    const asset = state.project.assets.get(unsafeBrandId<'AssetId'>(text));
    return asset === undefined
      ? 'The project has no asset with that identifier.'
      : { kind: 'asset', asset };
  }
  const region = state.project.regions.get(unsafeBrandId<'RegionId'>(text));
  const asset = region === undefined ? undefined : state.project.assets.get(region.assetId);
  return region === undefined || asset === undefined
    ? 'The project has no region with that identifier.'
    : { kind: 'region', region, asset };
}

/**
 * The chain the argument `chainId` names, `undefined` where it is absent, or
 * why it is no chain of the project.
 */
function chainNamed(
  state: ProjectState,
  invocation: CommandInvocation,
): DomainResult<EffectChainId | undefined> {
  const text = optionalTextArgument(invocation, 'chainId');
  if (!text.ok) return text;
  if (text.value === undefined) return succeed(undefined);
  const id = unsafeBrandId<'EffectChainId'>(text.value);
  return isWellFormedId(text.value) && state.project.effectChains.has(id)
    ? succeed(id)
    : fail(
        failure(
          'rack.chain-unknown',
          FailureKind.Rejected,
          'The project has no chain with that identifier.',
        ),
      );
}

/** The arguments that name `target`. */
function targetArguments(target: RackTarget): Readonly<Record<string, string>> {
  return target.kind === 'asset' ? { assetId: target.asset.id } : { regionId: target.region.id };
}

/** The invocation that gives `target` the rack `chain`, or takes its rack away where it is absent. */
export function setRackInvocation(
  target: RackTarget,
  chain: EffectChainId | undefined,
): CommandInvocation {
  return {
    commandId: ProjectCommandId.SetRack,
    arguments: { ...targetArguments(target), ...(chain === undefined ? {} : { chainId: chain }) },
  };
}

/** The invocation that points the rack edit `operation` of `target` at `chain`. */
export function setEditChainInvocation(
  target: RackTarget,
  operation: EditOperation['id'],
  chain: EffectChainId,
): CommandInvocation {
  return {
    commandId: ProjectCommandId.SetEditChain,
    arguments: { ...targetArguments(target), operationId: operation, chainId: chain },
  };
}

/** The state with `asset` given the rack `rack`, or none where it is absent. */
function withAssetRack(
  state: ProjectState,
  asset: Asset,
  rack: EffectChainId | undefined,
): ProjectState {
  const { rack: _previous, ...rest } = asset;
  const next: Asset = rack === undefined ? rest : { ...rest, rack };
  return {
    ...state,
    project: { ...state.project, assets: new Map([...state.project.assets, [asset.id, next]]) },
  };
}

/** The region with the rack `rack`, or none where it is absent. */
function regionWithRack(region: Region, rack: EffectChainId | undefined): Region {
  const { rack: _previous, ...rest } = region;
  return rack === undefined ? rest : { ...rest, rack };
}

function setRack(state: ProjectState, invocation: CommandInvocation) {
  const target = rackTarget(state, invocation);
  if (typeof target === 'string') return refusal('rack.target-unknown', target);
  const named = chainNamed(state, invocation);
  if (!named.ok) return refusedBy(named);
  const chain = named.value;
  const before = target.kind === 'asset' ? target.asset.rack : target.region.rack;
  if (before === chain) return unchanged('rack.unchanged', 'The rack is already as asked.');
  const next =
    target.kind === 'asset'
      ? withAssetRack(state, target.asset, chain)
      : withRegion(state, regionWithRack(target.region, chain));
  const name = quoted(
    target.kind === 'asset' ? target.asset.displayName : target.region.displayName,
  );
  return applied(
    next,
    setRackInvocation(target, before),
    chain === undefined ? `Take away the rack of ${name}` : `Give ${name} a rack`,
  );
}

function setEditChain(state: ProjectState, invocation: CommandInvocation) {
  const target = rackTarget(state, invocation);
  if (typeof target === 'string') return refusal('rack.target-unknown', target);
  const named = chainNamed(state, invocation);
  if (!named.ok) return refusedBy(named);
  const chain = named.value;
  if (chain === undefined)
    return refusal('rack.chain-unknown', 'The command names the chain to use.');
  const operationId = textArgument(invocation, 'operationId');
  if (!operationId.ok) return refusedBy(operationId);
  const pointed = <T extends EditOperation | RegionOperation>(operation: T): T | undefined =>
    operation.id === operationId.value && 'edit' in operation && operation.edit.kind === 'rack'
      ? { ...operation, edit: { kind: 'rack', chain } }
      : undefined;
  const operations: readonly (EditOperation | RegionOperation)[] =
    target.kind === 'asset' ? target.asset.edits : target.region.operations;
  const index = operations.findIndex((operation) => pointed(operation) !== undefined);
  const old = operations[index];
  if (old === undefined || !('edit' in old) || old.edit.kind !== 'rack') {
    return refusal(
      'rack.edit-unknown',
      'There is no range processed by a chain with that identifier.',
    );
  }
  if (old.edit.chain === chain)
    return unchanged('rack.unchanged', 'The range already uses that chain.');
  const next =
    target.kind === 'asset'
      ? withAssetEdits(
          state,
          target.asset,
          target.asset.edits.map((one) => pointed(one) ?? one),
        )
      : withRegion(state, {
          ...target.region,
          operations: target.region.operations.map((one) => pointed(one) ?? one),
        });
  const name = quoted(
    target.kind === 'asset' ? target.asset.displayName : target.region.displayName,
  );
  return applied(
    next,
    setEditChainInvocation(target, old.id, old.edit.chain),
    `Change the chain a range of ${name} is processed by`,
  );
}

/** The commands that name chains from assets and regions. */
export function rackCommands(): readonly ProjectCommand[] {
  return [
    projectCommand({
      id: ProjectCommandId.SetRack,
      label: 'Set the rack of an asset or a region',
      category: CommandCategory.Edit,
      description:
        'Gives an asset or a region a rack, a chain that processes the whole of it, or takes it away.',
      provenance: NO_PROVENANCE,
      run: (state, invocation) => setRack(state, invocation),
    }),
    projectCommand({
      id: ProjectCommandId.SetEditChain,
      label: 'Change the chain a range is processed by',
      category: CommandCategory.Edit,
      description: 'Points a range processed by a chain at another chain of the project.',
      provenance: NO_PROVENANCE,
      run: (state, invocation) => setEditChain(state, invocation),
    }),
  ];
}
