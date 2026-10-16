/**
 * A project state with asset groups, for the tests of the game commands and of
 * the commands a group changes the meaning of: the reference state, made into
 * one through the game commands themselves, so it is a state they produce.
 *
 * ```
 * Footsteps          processing: chain A   footstep asset (inherit, rack A),
 *                                          rain asset (own, no rack)
 *   Footsteps/Gravel   (inherits A)        the loop region (inherit, rack A)
 * Ambience           processing: none
 * ```
 */

import {
  instantiateProcessor,
  type Asset,
  type EffectChain,
  type IdGenerator,
  type Region,
} from '@audiogubbins/domain';
import { TEST_FILTER } from '@audiogubbins/domain/testing';
import type { GameAssetGroup, GroupMember } from '@audiogubbins/game-audio';
import type { ProjectState } from '@audiogubbins/project-format';

import { addGroupInvocation, assignMemberInvocation } from '../game/game-invocations.js';
import { appliedOf, projectBus } from './bus-runs.js';

export interface GroupedState {
  readonly state: ProjectState;
  readonly groups: {
    readonly footsteps: GameAssetGroup;
    readonly gravel: GameAssetGroup;
    readonly ambience: GameAssetGroup;
  };
  /** The chain Footsteps names, and one the project does not hold yet. */
  readonly chains: { readonly a: EffectChain; readonly b: EffectChain };
  readonly members: {
    readonly footstep: GroupMember;
    readonly rain: GroupMember;
    readonly loop: GroupMember;
  };
}

/** A chain of one filter, its identifiers drawn from `ids`. */
export function filterChain(ids: IdGenerator): EffectChain {
  return {
    id: ids.next<'EffectChainId'>(),
    slots: [instantiateProcessor(ids.next<'ProcessorId'>(), TEST_FILTER)],
  };
}

/** {@link GroupedState} over `state`, whose assets and region it names. */
export function groupedState(
  state: ProjectState,
  { footstep, rain }: { readonly footstep: Asset; readonly rain: Asset },
  loop: Region,
  ids: IdGenerator,
): GroupedState {
  const a = filterChain(ids);
  const b = filterChain(ids);
  const footsteps: GameAssetGroup = {
    id: ids.next<'GameAssetGroupId'>(),
    name: 'Footsteps',
    policy: { processing: a.id },
  };
  const gravel: GameAssetGroup = {
    id: ids.next<'GameAssetGroupId'>(),
    name: 'Gravel',
    parent: footsteps.id,
    policy: {},
  };
  const ambience: GameAssetGroup = {
    id: ids.next<'GameAssetGroupId'>(),
    name: 'Ambience',
    policy: { processing: 'none' },
  };
  const members: GroupedState['members'] = {
    footstep: { kind: 'asset', asset: footstep.id },
    rain: { kind: 'asset', asset: rain.id },
    loop: { kind: 'region', region: loop.id },
  };
  const bus = projectBus();
  let grouped = state;
  for (const invocation of [
    addGroupInvocation(footsteps, a),
    addGroupInvocation(gravel),
    addGroupInvocation(ambience),
    assignMemberInvocation(members.footstep, footsteps.id, 'inherit'),
    assignMemberInvocation(members.rain, footsteps.id, 'own'),
    assignMemberInvocation(members.loop, gravel.id, 'inherit'),
  ]) {
    grouped = appliedOf(bus.execute(grouped, invocation)).next;
  }
  return { state: grouped, groups: { footsteps, gravel, ambience }, chains: { a, b }, members };
}
