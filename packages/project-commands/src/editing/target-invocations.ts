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
  type RangeEdit,
} from '@audiogubbins/domain';

import { applyInvocation } from './edit-commands.js';
import { applyRegionEditInvocation } from './region-commands.js';

/**
 * The invocation that processes `target`'s range with `edit`, as operation
 * `id`. A level edit acts on the target's channels; a channel edit names its
 * own channels and takes no scope, so the target's are not kept on it.
 */
export function processTargetInvocation(
  target: EditTarget,
  id: EditOperationId,
  edit: RangeEdit,
): CommandInvocation {
  const { range } = target;
  const channels =
    target.channels === undefined || !isLevelEdit(edit) ? {} : { channels: target.channels };
  switch (target.kind) {
    case 'region':
      return applyRegionEditInvocation(
        { id: target.region },
        { id, basis: target.basis, range, ...channels, edit },
      );
    case 'asset':
      return applyInvocation({ id: target.asset }, { id, kind: 'process', range, ...channels, edit });
  }
}
