import { describe, expect, it } from 'vitest';

import {
  createDeterministicIdGenerator,
  instantiateProcessor,
  processorsOf,
  type EffectChain,
} from '@audiogubbins/domain';
import {
  TEST_FILTER,
  TEST_LIMITER,
  expectFailureCode,
  expectSuccess,
} from '@audiogubbins/domain/testing';

import { chainFromProcessing, copyProcessing, pasteProcessing } from './processing-payload.js';

const ids = createDeterministicIdGenerator(71);

function chainOf(): EffectChain {
  return {
    id: ids.next(),
    slots: [
      instantiateProcessor(ids.next(), TEST_FILTER),
      instantiateProcessor(ids.next(), TEST_LIMITER),
    ],
  };
}

describe('copying and pasting processing (ADR-0053 as amended)', () => {
  it('pastes copies under new identifiers, in their order, so pasting twice makes two of each', () => {
    const source = chainOf();
    const payload = expectSuccess(copyProcessing(source.slots, false));
    const target: EffectChain = { id: ids.next(), slots: [] };
    const once = expectSuccess(pasteProcessing(payload, target, { index: 0 }, ids));
    const twice = expectSuccess(pasteProcessing(payload, once, { index: 2 }, ids));
    expect(twice.slots.map((slot) => (slot.kind === 'processor' ? slot.typeKey : 'group'))).toEqual(
      ['low-pass-filter', 'look-ahead-limiter', 'low-pass-filter', 'look-ahead-limiter'],
    );
    const pastedIds = new Set<string>([...processorsOf(twice.slots)].map((one) => one.id));
    expect(pastedIds.size).toBe(4);
    for (const slot of source.slots) expect(pastedIds.has(slot.id)).toBe(false);
  });

  it('makes a new chain for a target without a rack, its identifiers its own', () => {
    const payload = expectSuccess(copyProcessing(chainOf().slots, true));
    const made = chainFromProcessing(payload, ids);
    expect(made.slots).toHaveLength(2);
    expect(payload.slots.some((slot) => slot.id === made.slots[0]?.id)).toBe(false);
  });

  it('refuses to copy nothing and to paste at a place the rack does not have', () => {
    expect(expectFailureCode(copyProcessing([], false))).toBe('clipboard.nothing-to-copy');
    const payload = expectSuccess(copyProcessing(chainOf().slots, false));
    expect(
      expectFailureCode(pasteProcessing(payload, { id: ids.next(), slots: [] }, { index: 3 }, ids)),
    ).toBe('clipboard.paste-place');
  });
});
