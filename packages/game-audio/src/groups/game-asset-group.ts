/**
 * An asset group (ADR-0101): one node of the project's forest of groups, with
 * the policy it sets for everything under it.
 */

import type { InheritedPolicy } from '../policy/inherited-policy.js';
import type { GameAssetGroupId } from './group-ids.js';

export interface GameAssetGroup {
  readonly id: GameAssetGroupId;

  /**
   * One path segment (`group-names.ts`): 1 to 128 characters, NFC, no `/`, no
   * control character and no space at either end, so `Footsteps/Grass` is the
   * path of `Grass` under `Footsteps`, never one name.
   */
  readonly name: string;

  /** The group this one is inside; a root has none. */
  readonly parent?: GameAssetGroupId;

  /** The fields this group sets; a field it does not set is inherited from its parent. */
  readonly policy: InheritedPolicy;
}
