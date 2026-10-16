/**
 * How a group's processing is heard (ADR-0101): as the rack of each member that
 * inherits it, naming the group's chain, a shared chain (ADR-0060). The plan
 * knows no group, so the rack is the one place processing is heard.
 *
 * The rack an `inherit` member must have is the chain the nearest group that
 * sets `processing` names, and no rack where that is `none` or no group sets
 * it. The game commands set every inheriting member's rack to this in the same
 * command as the change that moves it, and the validator refuses a state where
 * one differs. Pure: the commands call it, never the interface.
 */

import type { EffectChainId } from '@audiogubbins/domain';

import type { GameAudioState } from '../groups/game-audio-state.js';
import type { GroupMember } from '../groups/membership.js';
import { groupPolicies, membershipOf, type GroupEffectivePolicy } from './policy-resolution.js';

/** The rack a member inheriting from `policy` has: its chain, or none for `none` or unset. */
export function rackInherited(policy: GroupEffectivePolicy): EffectChainId | undefined {
  const { value } = policy.fields.processing;
  return value === 'none' ? undefined : value;
}

/**
 * The chain `member` inherits as its rack, or `undefined` where it inherits no
 * rack or is in no group: whatever its membership records.
 */
export function inheritedProcessing(
  state: GameAudioState,
  member: GroupMember,
): EffectChainId | undefined {
  const membership = membershipOf(state, member);
  return membership === undefined
    ? undefined
    : rackInherited(groupPolicies(state)(membership.group));
}

/** The rack each `inherit` member must have in `state`: the full set, in membership order, not a difference. */
export function inheritingRacks(
  state: GameAudioState,
): readonly { readonly member: GroupMember; readonly rack: EffectChainId | undefined }[] {
  const policyOf = groupPolicies(state);
  return state.memberships
    .filter((membership) => membership.processing === 'inherit')
    .map((membership) => ({
      member: membership.member,
      rack: rackInherited(policyOf(membership.group)),
    }));
}
