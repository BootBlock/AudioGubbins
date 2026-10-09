/**
 * The commands that name a chain from an asset or a region (ADR-0060): giving
 * a target a rack, replacing it or taking it away, and pointing a range's rack
 * edit at another chain, which is how a shared chain is made independent for
 * one of the things that name it.
 *
 * Each names a chain by its identifier or gives it whole, and removes a chain
 * it leaves nothing naming, as `chain-naming.ts` says, so one undo restores
 * the chain with the naming. A rack edit changes no time, so pointing it at
 * another chain moves nothing placed on the asset, and the edit stays where it
 * is in the chain of edits.
 */

import {
  CommandCategory,
  refusal,
  unchanged,
  type CommandInvocation,
} from '@audiogubbins/commands';
import {
  assetChains,
  copyChain,
  isWellFormedId,
  regionChains,
  unsafeBrandId,
  type Asset,
  type EditOperation,
  type EffectChain,
  type EffectChainId,
  type IdGenerator,
  type Project,
  type Region,
  type RegionOperation,
  type TargetChains,
} from '@audiogubbins/domain';
import type { ProjectState } from '@audiogubbins/project-format';
import { quoted } from '@audiogubbins/text';

import { optionalTextArgument, refusedBy, textArgument } from '../invocation-arguments.js';
import {
  NO_PROVENANCE,
  ProjectCommandId,
  applied,
  projectCommand,
  type ProjectCommand,
} from '../project-command.js';
import { withAssetEdits, withRegion } from '../editing/editing-state.js';
import { chainToName, namingArguments, withoutUnnamed } from './chain-naming.js';

/** What a rack command acts on: an asset, or a region and its asset. */
export type RackTarget =
  | { readonly kind: 'asset'; readonly asset: Asset }
  | { readonly kind: 'region'; readonly region: Region; readonly asset: Asset };

/** The chains `target` names, by the domain's one account of them. */
export function targetChains(target: RackTarget): TargetChains {
  return target.kind === 'asset' ? assetChains(target.asset) : regionChains(target.region);
}

/** What `target` is called in an undo description, quoted. */
function targetName(target: RackTarget): string {
  return quoted(target.kind === 'asset' ? target.asset.displayName : target.region.displayName);
}

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

/** The arguments that name `target`. */
function targetArguments(target: RackTarget): Readonly<Record<string, string>> {
  return target.kind === 'asset' ? { assetId: target.asset.id } : { regionId: target.region.id };
}

/**
 * The invocation that gives `target` the rack `chain`, named by its
 * identifier or given whole to be added with it, or takes its rack away where
 * it is absent.
 */
export function setRackInvocation(
  target: RackTarget,
  chain: EffectChainId | EffectChain | undefined,
): CommandInvocation {
  return {
    commandId: ProjectCommandId.SetRack,
    arguments: { ...targetArguments(target), ...namingArguments(chain) },
  };
}

/**
 * The invocation that points the rack edit `operation` of `target` at
 * `chain`, named by its identifier or given whole to be added with it.
 */
export function setEditChainInvocation(
  target: RackTarget,
  operation: EditOperation['id'],
  chain: EffectChainId | EffectChain,
): CommandInvocation {
  return {
    commandId: ProjectCommandId.SetEditChain,
    arguments: { ...targetArguments(target), operationId: operation, ...namingArguments(chain) },
  };
}

/**
 * The invocations that make `target`'s every naming of the shared chain
 * `chain`, its rack and each range it processes, name `copy` instead, the
 * first giving the copy whole; none where `target` does not name `chain`.
 */
export function independentChainInvocations(
  target: RackTarget,
  chain: EffectChainId,
  copy: EffectChain,
): readonly CommandInvocation[] {
  const { rack, ranges } = targetChains(target);
  let given = false;
  const naming = (): EffectChainId | EffectChain => {
    if (given) return copy.id;
    given = true;
    return copy;
  };
  return [
    ...(rack === chain ? [setRackInvocation(target, naming())] : []),
    ...ranges
      .filter((range) => range.chain === chain)
      .map((range) => setEditChainInvocation(target, range.operation, naming())),
  ];
}

/**
 * The invocations that make a copy of `chain` the rack of every one of
 * `targets`, in place of any rack each has: a copy of its own each, or one
 * copy they all name where `share` asks, the shared chain of REQ-EDIT-014. A
 * rack replaced goes with the last of them to name it.
 */
export function rackEachInvocations(
  targets: readonly RackTarget[],
  chain: EffectChain,
  share: boolean,
  ids: IdGenerator,
): readonly CommandInvocation[] {
  if (!share) return targets.map((target) => setRackInvocation(target, copyChain(chain, ids)));
  const shared = copyChain(chain, ids);
  return targets.map((target, index) =>
    setRackInvocation(target, index === 0 ? shared : shared.id),
  );
}

/**
 * The invocation that gives `target` a rack of its own of `chain`'s slots
 * after a copy of its rack's, where it has one, so it hears what it heard
 * and then `chain`, and another target sharing that rack hears no change.
 */
export function extendedRackInvocation(
  project: Project,
  target: RackTarget,
  chain: EffectChain,
  ids: IdGenerator,
): CommandInvocation {
  const { rack } = targetChains(target);
  const kept = rack === undefined ? undefined : project.effectChains.get(rack);
  const before = kept === undefined ? [] : copyChain(kept, ids).slots;
  return setRackInvocation(target, { id: chain.id, slots: [...before, ...chain.slots] });
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
  const named = chainToName(state, invocation);
  if (!named.ok) return refusedBy(named);
  const chain = named.value?.chain;
  const before = target.kind === 'asset' ? target.asset.rack : target.region.rack;
  if (before === chain) return unchanged('rack.unchanged', 'The rack is already as asked.');
  const naming = named.value?.state ?? state;
  const next = withoutUnnamed(
    target.kind === 'asset'
      ? withAssetRack(naming, target.asset, chain)
      : withRegion(naming, regionWithRack(target.region, chain)),
    before,
  );
  const name = targetName(target);
  return applied(
    next.state,
    setRackInvocation(target, next.removed ?? before),
    chain === undefined ? `Take away the rack of ${name}` : `Give ${name} a rack`,
  );
}

function setEditChain(state: ProjectState, invocation: CommandInvocation) {
  const target = rackTarget(state, invocation);
  if (typeof target === 'string') return refusal('rack.target-unknown', target);
  const named = chainToName(state, invocation);
  if (!named.ok) return refusedBy(named);
  if (named.value === undefined)
    return refusal('rack.chain-unknown', 'The command names the chain to use.');
  const { chain, state: naming } = named.value;
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
  const next = withoutUnnamed(
    target.kind === 'asset'
      ? withAssetEdits(
          naming,
          target.asset,
          target.asset.edits.map((one) => pointed(one) ?? one),
        )
      : withRegion(naming, {
          ...target.region,
          operations: target.region.operations.map((one) => pointed(one) ?? one),
        }),
    old.edit.chain,
  );
  return applied(
    next.state,
    setEditChainInvocation(target, old.id, next.removed ?? old.edit.chain),
    `Change the chain a range of ${targetName(target)} is processed by`,
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
      description: 'Points a range processed by a chain at another chain.',
      provenance: NO_PROVENANCE,
      run: (state, invocation) => setEditChain(state, invocation),
    }),
  ];
}
