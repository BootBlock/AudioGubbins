/**
 * Putting a chain of processors on what a command acts on, through the
 * project's own commands (ADR-0060): over a range of an asset or a region, as
 * a rack edit naming the chain, or over a whole asset or region, as its rack.
 * Shared by the commands that place a chain they made or were given, so a
 * range and a rack are placed by one rule wherever the chain came from.
 */

import type { CommandInvocation } from '@audiogubbins/commands';
import type { EditTarget, EffectChain } from '@audiogubbins/domain';
import {
  addChainInvocation,
  processTargetInvocation,
  type RackTarget,
} from '@audiogubbins/project-commands';

import type { ProjectOwner } from '../assets/editor-asset.js';
import type { ShellContext } from './shell-context.js';

/** What a target's rack command names: the asset a view shows, or its region. */
export function rackTargetOf(owner: ProjectOwner): RackTarget {
  return owner.region === undefined
    ? { kind: 'asset', asset: owner.asset }
    : { kind: 'region', region: owner.region, asset: owner.asset };
}

/**
 * The invocations that add `chain` to the project and process `target`'s
 * range with it, as a rack edit with an identity of its own: a region's own
 * processing where the target is a region, the asset's chain otherwise.
 */
export function rangeRackInvocations(
  context: ShellContext,
  target: EditTarget,
  chain: EffectChain,
): readonly [CommandInvocation, ...CommandInvocation[]] {
  return [
    addChainInvocation(chain),
    processTargetInvocation(target, context.ids.next<'EditOperationId'>(), {
      kind: 'rack',
      chain: chain.id,
    }),
  ];
}
