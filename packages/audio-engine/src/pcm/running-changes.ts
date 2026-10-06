/**
 * What changed between two plans of one sound, where all that changed is the
 * values of numeric parameters: the changes playback can take while it plays
 * (`running-parameters.ts`), rather than loading the sound again.
 *
 * Anything else, a segment, a stage, a slot added, moved or bypassed, a
 * choice or a learned state, changes what the chains are or what they read,
 * which a running chain cannot take: the plans then have no running changes,
 * and playback loads the new one.
 */

import {
  processorsOf,
  type ChainSlot,
  type EditPlan,
  type ParameterId,
  type ParameterValue,
  type ProcessorId,
  type ProcessorInstance,
} from '@audiogubbins/domain';

import { canonicalText } from '../preview/canonical-text.js';
import type { ParameterChange } from './running-parameters.js';

/** Stands in for every numeric value, so two plans that differ only in those read alike. */
const NUMBER = '#number';

/** `slot` with every numeric parameter value written as {@link NUMBER}. */
function withNumbersHidden(slot: ChainSlot): ChainSlot {
  if (slot.kind === 'processor') {
    const values = new Map<ParameterId, ParameterValue>(
      [...slot.values].map(([parameter, value]) => [
        parameter,
        typeof value === 'number' ? NUMBER : value,
      ]),
    );
    return { ...slot, values };
  }
  return {
    ...slot,
    branches: slot.branches.map((branch) => ({ slots: branch.slots.map(withNumbersHidden) })),
  };
}

/** The plan's text with every numeric parameter value hidden. */
function shapeOf(plan: EditPlan): string {
  return canonicalText(
    plan.streams.map((stream) =>
      stream.processing?.kind === 'chain'
        ? {
            ...stream,
            processing: {
              ...stream.processing,
              chain: {
                ...stream.processing.chain,
                slots: stream.processing.chain.slots.map(withNumbersHidden),
              },
            },
          }
        : stream,
    ),
  );
}

/** Every processor of the plan's chains, by identifier. */
function processorsIn(plan: EditPlan): ReadonlyMap<ProcessorId, ProcessorInstance> {
  const found = new Map<ProcessorId, ProcessorInstance>();
  for (const stream of plan.streams) {
    if (stream.processing?.kind !== 'chain') continue;
    for (const processor of processorsOf(stream.processing.chain.slots)) {
      found.set(processor.id, processor);
    }
  }
  return found;
}

/**
 * The numeric parameter values `after` gives that `before` did not, each
 * once however many streams share its chain, or `undefined` where the plans
 * differ in anything else.
 */
export function runningChanges(
  before: EditPlan,
  after: EditPlan,
): readonly ParameterChange[] | undefined {
  if (shapeOf(before) !== shapeOf(after)) return undefined;
  const was = processorsIn(before);
  const changes: ParameterChange[] = [];
  for (const [id, processor] of processorsIn(after)) {
    const old = was.get(id);
    for (const [parameter, value] of processor.values) {
      if (typeof value === 'number' && old?.values.get(parameter) !== value) {
        changes.push({ processor: id, parameter, value });
      }
    }
  }
  return changes;
}
