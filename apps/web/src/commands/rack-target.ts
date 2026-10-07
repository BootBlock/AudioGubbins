/**
 * What the rack commands, the Effects rack panel and the Inspector act on
 * (ADR-0060): the asset or region of the editor in use whose rack is shown,
 * the chains it names, and the slots a command names or the person selected.
 *
 * The target is the region a view shows, or the one region selected in a
 * view of its asset, by the rule the region commands follow
 * (`regionsInView`); with processors selected, the asset or region that runs
 * them, so selecting a processor in a region's rack keeps that rack shown;
 * and the asset otherwise. One rule for the commands and the views, so a
 * control acts on the rack it is drawn in.
 */

import type { CommandInvocation } from '@audiogubbins/commands';
import {
  chainUsers,
  findSlot,
  isWellFormedId,
  unsafeBrandId,
  type Asset,
  type ChainSlot,
  type EditOperationId,
  type EditRange,
  type EffectChain,
  type EffectChainId,
  type Project,
  type Region,
} from '@audiogubbins/domain';
import type { RackTarget } from '@audiogubbins/project-commands';
import type { ProjectState } from '@audiogubbins/project-format';
import { quoted } from '@audiogubbins/text';
import type { SelectionSet } from '@audiogubbins/timeline';

import type { ProjectOwner } from '../assets/editor-asset.js';
import { editedView } from './edit-target.js';
import type { EditorTarget } from './editor-target.js';
import type { ProjectTarget } from './project-edits.js';
import { regionsInView } from './region-target.js';
import { textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** A range of a target processed by a chain: one of its rack edits. */
export interface RangeRack {
  readonly operation: EditOperationId;
  /** Where it lies on the asset's timeline at the place it was made. */
  readonly range: EditRange;
  readonly chain: EffectChainId;
}

/** Every chain `target` names: its rack, and each range of it a chain processes. */
export interface TargetChains {
  readonly rack: EffectChainId | undefined;
  readonly ranges: readonly RangeRack[];
}

/** The chains `target` names, in the order its edits were made. */
export function chainsOfTarget(target: RackTarget): TargetChains {
  if (target.kind === 'asset') {
    return {
      rack: target.asset.rack,
      ranges: target.asset.edits.flatMap((operation) =>
        operation.kind === 'process' && operation.edit.kind === 'rack'
          ? [{ operation: operation.id, range: operation.range, chain: operation.edit.chain }]
          : [],
      ),
    };
  }
  return {
    rack: target.region.rack,
    ranges: target.region.operations.flatMap((operation) =>
      operation.edit.kind === 'rack'
        ? [{ operation: operation.id, range: operation.range, chain: operation.edit.chain }]
        : [],
    ),
  };
}

/** Whether `target` names the chain that holds the slot `slot`. */
function runs(target: RackTarget, project: Project, slot: string): boolean {
  const { rack, ranges } = chainsOfTarget(target);
  return [rack, ...ranges.map((range) => range.chain)].some((id) => {
    const chain = id === undefined ? undefined : project.effectChains.get(id);
    return chain !== undefined && findSlot(chain, slot) !== undefined;
  });
}

/** The region `id` of `asset`, as the project holds it, or `undefined`. */
function regionOf(project: Project, asset: Asset, id: string): Region | undefined {
  const region = isWellFormedId(id)
    ? project.regions.get(unsafeBrandId<'RegionId'>(id))
    : undefined;
  return region?.assetId === asset.id ? region : undefined;
}

/**
 * The asset or region whose rack the view of `owner` shows, with `selection`
 * made in it, as `project` holds each (see the module comment).
 */
export function rackTargetIn(
  owner: ProjectOwner,
  selection: SelectionSet,
  project: Project,
): RackTarget {
  const asset = project.assets.get(owner.asset.id) ?? owner.asset;
  const whole: RackTarget = { kind: 'asset', asset };
  const [only, ...others] = regionsInView(owner, selection);
  if (only !== undefined && others.length === 0) {
    const region = regionOf(project, asset, only);
    if (region !== undefined) return { kind: 'region', region, asset };
  }
  const objects = selection.objects;
  if (objects?.kind !== 'processors') return whole;
  const [first] = objects.ids;
  if (runs(whole, project, first)) return whole;
  for (const region of project.regions.values()) {
    if (region.assetId !== asset.id) continue;
    const target: RackTarget = { kind: 'region', region, asset };
    if (runs(target, project, first)) return target;
  }
  return whole;
}

/**
 * What else uses the chain `chain` besides `target`, each named as a reader
 * is told: the assets and regions whose rack it is, or a range of which it
 * processes. A chain is shared where this holds anything.
 */
export function otherUsers(
  project: Project,
  chain: EffectChainId,
  target: RackTarget,
): readonly string[] {
  const users = chainUsers(project, chain);
  const own = target.kind === 'asset' ? target.asset.id : target.region.id;
  const assetName = (id: string): string =>
    quoted(project.assets.get(unsafeBrandId<'AssetId'>(id))?.displayName ?? 'an asset');
  const regionName = (id: string): string =>
    quoted(project.regions.get(unsafeBrandId<'RegionId'>(id))?.displayName ?? 'a region');
  const named = (ids: readonly string[], name: (id: string) => string, what: string) =>
    ids.filter((id) => id !== own).map((id) => `${what} of ${name(id)}`);
  return [
    ...named(users.assetRacks, assetName, 'the rack'),
    ...named(users.regionRacks, regionName, 'the rack'),
    ...named(users.assetEdits, assetName, 'a range'),
    ...named(users.regionEdits, regionName, 'a range'),
  ];
}

/** What a target is called in a sentence, quoted. */
export function targetName(target: RackTarget): string {
  return quoted(target.kind === 'asset' ? target.asset.displayName : target.region.displayName);
}

/** What a rack command acts on: the view, the project, and the target whose rack is shown. */
export interface RackScope {
  readonly view: EditorTarget;
  readonly project: ProjectTarget;
  readonly state: ProjectState;
  readonly target: RackTarget;
}

/** The rack the view an invocation names shows, or the editor in use; or why there is none. */
export function rackScope(
  context: ShellContext,
  invocation: CommandInvocation,
): RackScope | string {
  const found = editedView(context, invocation);
  if (typeof found === 'string') return found;
  const { view, project } = found;
  const { state } = project;
  return {
    view,
    project,
    state,
    target: rackTargetIn(project.owner, context.selections.of(view.asset.id), state.project),
  };
}

/** A chain of the project the scope's target names, and the chain itself. */
export interface NamedChain {
  readonly id: EffectChainId;
  readonly chain: EffectChain;
}

/**
 * The chain the invocation names by `chainId`, which must be one the scope's
 * target names; or, where it names none, the target's rack, or `undefined`
 * where it has none; or why the one named is not the target's.
 */
export function targetChain(
  scope: RackScope,
  invocation: CommandInvocation,
): NamedChain | undefined | { readonly refused: string } {
  const { rack, ranges } = chainsOfTarget(scope.target);
  const named = textArgument(invocation, 'chainId');
  const id =
    named === undefined
      ? rack
      : [rack, ...ranges.map((range) => range.chain)].find((one) => one === named);
  if (named !== undefined && id === undefined) {
    return { refused: `${targetName(scope.target)} does not use that chain.` };
  }
  if (id === undefined) return undefined;
  const chain = scope.state.project.effectChains.get(id);
  return chain === undefined
    ? { refused: 'The rack names a chain the project does not hold.' }
    : { id, chain };
}

/** A slot of a chain of the project, and the chain it is in. */
export interface HeldSlot {
  readonly slot: ChainSlot;
  readonly chain: EffectChain;
}

/** The slot `id` among the project's chains, and its chain, or `undefined`. */
function slotIn(state: ProjectState, id: string): HeldSlot | undefined {
  for (const chain of state.project.effectChains.values()) {
    const found = findSlot(chain, id);
    if (found !== undefined) return { slot: found.slot, chain };
  }
  return undefined;
}

/**
 * The slots an invocation names by `slot`, identifiers separated by commas,
 * or the processors selected in the editor in use; or why it names none, or
 * one the project does not hold.
 */
export function namedSlots(
  context: ShellContext,
  invocation: CommandInvocation,
  state: ProjectState,
): readonly [HeldSlot, ...HeldSlot[]] | string {
  const named = textArgument(invocation, 'slot');
  let ids: readonly string[];
  if (named === undefined) {
    const view = editedView(context, invocation);
    if (typeof view === 'string') return view;
    const objects = context.selections.of(view.view.asset.id).objects;
    ids = objects?.kind === 'processors' ? objects.ids : [];
  } else {
    ids = named.split(',').map((part) => part.trim());
  }
  const held: HeldSlot[] = [];
  for (const id of ids) {
    const found = slotIn(state, id);
    if (found === undefined) return 'The project has no such processor or group.';
    held.push(found);
  }
  const [first, ...rest] = held;
  return first === undefined
    ? 'Select a processor in the rack, or name one, first.'
    : [first, ...rest];
}
