/**
 * Processing made on an edit's target (ADR-0051): a region's own chain where
 * the target is a region, so two regions over one recording are processed
 * independently, and the asset's chain anywhere else.
 *
 * An operation that changes time or the layout is never processing: it is
 * made on the asset's chain whatever the target, through `applyInvocation`.
 */

import type { CommandInvocation } from '@audiogubbins/commands';
import {
  isLevelEdit,
  type EditOperationId,
  type EditTarget,
  type EffectChain,
  type RangeEdit,
} from '@audiogubbins/domain';

import { applyInvocation } from './edit-commands.js';
import { applyRegionEditInvocation } from './region-invocations.js';

/**
 * The invocation that processes `target`'s range with `edit`, as operation
 * `id`, a rack edit's chain going with it where `chain` is given whole. A
 * level edit acts on the target's channels; a channel edit names its own
 * channels and takes no scope, so the target's are not kept on it.
 */
export function processTargetInvocation(
  target: EditTarget,
  id: EditOperationId,
  edit: RangeEdit,
  chain?: EffectChain,
): CommandInvocation {
  const { range } = target;
  const channels =
    target.channels === undefined || !isLevelEdit(edit) ? {} : { channels: target.channels };
  switch (target.kind) {
    case 'region':
      return applyRegionEditInvocation(
        { id: target.region },
        { id, basis: target.basis, range, ...channels, edit },
        chain,
      );
    case 'asset':
      return applyInvocation(
        { id: target.asset },
        { id, kind: 'process', range, ...channels, edit },
        chain,
      );
  }
}

/**
 * The invocation that processes `target`'s range with `chain`, new to the
 * project and given whole, as a rack edit that is operation `id`.
 */
export function rackRangeInvocation(
  target: EditTarget,
  id: EditOperationId,
  chain: EffectChain,
): CommandInvocation {
  return processTargetInvocation(target, id, { kind: 'rack', chain: chain.id }, chain);
}
