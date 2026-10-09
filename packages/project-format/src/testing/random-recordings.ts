/**
 * Random take stacks for the property tests (ADR-0072): stacks over a
 * project's recorded assets, some of them a punch's. How a recorded asset was
 * recorded is made with its source (`random-values.ts`).
 *
 * Deterministic from the seed the `Random` was made with, like every value
 * the property tests are built from.
 */

import {
  AssetOrigin,
  FadeShape,
  TakeState,
  sampleCount,
  type Asset,
  type AssetId,
  type IdGenerator,
  type Take,
  type TakeStack,
  type TakeStackId,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import type { Random } from './random-values.js';

/** A random take of `asset`. */
function randomTake(random: Random, ids: IdGenerator, asset: AssetId): Take {
  return {
    id: ids.next<'TakeId'>(),
    asset,
    name: random.pick(['Take 1', 'Take 2 ✓', ' Take ']),
    note: random.pick(['', 'Breathy at the end.', 'Ünïcode — and a\nsecond line']),
    state: random.pick(Object.values(TakeState)),
    compensation: random.pick([0, 0, 128, -64]),
  };
}

/**
 * Up to three take stacks over the project's recorded `assets`, each with up
 * to three takes, a kept one now and then chosen, and some of them a punch's
 * of a short range a punch edit may name.
 */
export function randomTakeStacks(
  random: Random,
  ids: IdGenerator,
  assets: ReadonlyMap<AssetId, Asset>,
): Map<TakeStackId, TakeStack> {
  const recorded = [...assets.values()].filter((asset) => asset.origin === AssetOrigin.Recorded);
  const stacks = new Map<TakeStackId, TakeStack>();
  if (recorded.length === 0) return stacks;
  for (let count = random.below(4); count > 0; count -= 1) {
    const takes = Array.from({ length: 1 + random.below(3) }, () =>
      randomTake(random, ids, random.pick(recorded).id),
    );
    const kept = takes.filter((take) => take.state === TakeState.Kept);
    const chosen = kept.length > 0 && random.chance(0.8) ? random.pick(kept).id : undefined;
    const length = 2 + random.below(400);
    const stack: TakeStack = {
      id: ids.next<'TakeStackId'>(),
      name: random.pick(['Verse', 'Punch at 1:02', ' Chorus ']),
      takes,
      ...(chosen === undefined ? {} : { chosen }),
      ...(random.chance(0.6)
        ? {
            punch: {
              length: expectSuccess(sampleCount(length)),
              preRoll: expectSuccess(sampleCount(random.below(200))),
              postRoll: expectSuccess(sampleCount(random.below(200))),
              crossfade: {
                length: expectSuccess(sampleCount(random.below(Math.floor(length / 2) + 1))),
                shape: random.pick(Object.values(FadeShape)),
              },
              resampler: 1,
            },
          }
        : {}),
    };
    stacks.set(stack.id, stack);
  }
  return stacks;
}
