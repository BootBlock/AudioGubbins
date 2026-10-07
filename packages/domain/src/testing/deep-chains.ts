/**
 * The deepest chain the domain accepts: groups nested as deep as
 * `MAXIMUM_GROUP_DEPTH` lets them, the innermost holding a limiter, whose one
 * parameter gives the processor a value to write. Every reader a chain passes
 * through (a command's argument, the project document, the tree, a paste, a
 * worker's message, the library) is pinned with it, so a bound one of them
 * picked by hand rather than derived from the domain's is found.
 */

import type { IdGenerator } from '../identity/id-generator.js';
import { MAXIMUM_GROUP_DEPTH } from '../processing/chain-validation.js';
import {
  SummingLaw,
  instantiateProcessor,
  type ChainSlot,
  type EffectChain,
} from '../processing/effect-chain.js';
import { TEST_LIMITER } from './test-processors.js';

/** A limiter inside groups nested `depth` deep, each of one branch. */
export function nestedGroups(ids: IdGenerator, depth: number): ChainSlot {
  let slot: ChainSlot = instantiateProcessor(ids.next<'ProcessorId'>(), TEST_LIMITER);
  for (let level = 0; level < depth; level += 1) {
    slot = {
      kind: 'group',
      id: ids.next<'ProcessorGroupId'>(),
      enabled: true,
      soloed: false,
      mix: 1,
      summing: SummingLaw.EqualPower,
      branches: [{ slots: [slot] }],
    };
  }
  return slot;
}

/** A chain whose one slot is groups nested as deep as the domain allows. */
export function deepestChain(ids: IdGenerator): EffectChain {
  return { id: ids.next<'EffectChainId'>(), slots: [nestedGroups(ids, MAXIMUM_GROUP_DEPTH)] };
}
