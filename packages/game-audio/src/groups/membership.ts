/**
 * What belongs to a group, and how (ADR-0101).
 *
 * A member is a region or an asset, in at most one group, so its effective
 * policy has one answer. Its membership records the overrides it sets over its
 * group and whether its rack is its group's inherited processing chain or its
 * own: that record is the one authority on whether the member inherits, and the
 * validator holds the member's rack to it.
 */

import type { AssetId, RegionId } from '@audiogubbins/domain';

import type { PolicyOverrides } from '../policy/inherited-policy.js';
import type { GameAssetGroupId } from './group-ids.js';

export type GroupMember =
  | { readonly kind: 'region'; readonly region: RegionId }
  | { readonly kind: 'asset'; readonly asset: AssetId };

/** Whether the member's rack is its group's inherited chain, or its own: the one record of it. */
export type MemberProcessing = 'inherit' | 'own';

export interface GroupMembership {
  readonly member: GroupMember;
  readonly group: GameAssetGroupId;
  readonly processing: MemberProcessing;
  readonly overrides: PolicyOverrides;
}

/**
 * The key a member is known by in a map, the same for every value of one
 * member: `region:<id>` or `asset:<id>`. An identifier holds no `:`, so two
 * members never share a key.
 */
export function memberKey(member: GroupMember): string {
  return member.kind === 'region' ? `region:${member.region}` : `asset:${member.asset}`;
}
