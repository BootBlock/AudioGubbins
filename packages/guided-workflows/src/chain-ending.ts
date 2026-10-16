/**
 * How a chain is made to end with a workflow's processing (ADR-0060,
 * ADR-0105): its treatments added before its level, and its level last, so
 * normalising hears everything before it.
 *
 * What is already there is not added again. A treatment is there where the
 * chain holds a processor of its type at the same values; the level is there
 * where the chain ends with it. A chain that ends with a level of the same
 * type at other values has that processor set to the new values, so a chain
 * never ends with two normalisers of one kind, and treatments added go before
 * it. Each change is stated against the chain as the changes before it leave
 * it, as the slot commands read their places.
 */

import type { ChainSlot, ProcessorInstance } from '@audiogubbins/domain';

import { sameProcessor } from './existing-operations.js';

/** What a workflow puts at the end of a chain. */
export interface ChainProcessing {
  /** In signal order, each added only where the chain lacks it. */
  readonly treatments: readonly ProcessorInstance[];
  /** The level the chain ends with, where the workflow sets one. */
  readonly level: ProcessorInstance | undefined;
}

export type SlotChange =
  | { readonly kind: 'add'; readonly index: number; readonly processor: ProcessorInstance }
  /** The processor at `index` set to `processor`'s values, keeping its place and identity. */
  | { readonly kind: 'retune'; readonly index: number; readonly processor: ProcessorInstance };

export interface ChainEnding {
  /** In the order they are made. */
  readonly changes: readonly SlotChange[];
  /** The chain's slots once they are. */
  readonly slots: readonly ChainSlot[];
}

/** How `existing` comes to end with `processing`. */
export function chainEnding(
  existing: readonly ChainSlot[],
  processing: ChainProcessing,
): ChainEnding {
  const { treatments, level } = processing;
  const slots = [...existing];
  const changes: SlotChange[] = [];
  const last = existing.at(-1);
  const levelIndex = existing.length - 1;
  const endsWithLevel =
    level !== undefined && last?.kind === 'processor' && last.typeKey === level.typeKey;
  if (endsWithLevel && !sameProcessor(last, level)) {
    const processor: ProcessorInstance = { ...last, values: level.values };
    slots[levelIndex] = processor;
    changes.push({ kind: 'retune', index: levelIndex, processor });
  }
  let at = endsWithLevel ? levelIndex : existing.length;
  for (const treatment of treatments) {
    if (existing.some((slot) => sameProcessor(slot, treatment))) continue;
    slots.splice(at, 0, treatment);
    changes.push({ kind: 'add', index: at, processor: treatment });
    at += 1;
  }
  if (level !== undefined && !endsWithLevel) {
    slots.push(level);
    changes.push({ kind: 'add', index: slots.length - 1, processor: level });
  }
  return { changes, slots };
}
