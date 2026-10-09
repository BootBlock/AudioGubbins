import { describe, expect, it } from 'vitest';

import { unsafeBrandId, type EffectChainId } from '../identity/branded-id.js';
import { createDeterministicIdGenerator } from '../identity/id-generator.js';
import { LOOK_AHEAD, TEST_FILTER, TEST_LIMITER } from '../testing/test-processors.js';
import {
  copyChain,
  copySlot,
  findSlot,
  withSlotAt,
  withSlotMoved,
  withSlotReplaced,
  withoutSlot,
} from './chain-edits.js';
import {
  SummingLaw,
  instantiateProcessor,
  processorsOf,
  type ChainSlot,
  type EffectChain,
  type ParallelGroup,
  type ProcessorInstance,
} from './effect-chain.js';

const CHAIN_ID: EffectChainId = unsafeBrandId<'EffectChainId'>('33333333-aaaa');

function processor(suffix: string): ProcessorInstance {
  return instantiateProcessor(unsafeBrandId<'ProcessorId'>(`22222222-${suffix}`), TEST_FILTER);
}

function group(suffix: string, ...branches: (readonly ChainSlot[])[]): ParallelGroup {
  return {
    kind: 'group',
    id: unsafeBrandId<'ProcessorGroupId'>(`44444444-${suffix}`),
    enabled: true,
    soloed: false,
    mix: 1,
    summing: SummingLaw.Sum,
    branches: branches.map((slots) => ({ slots })),
  };
}

/** Every slot's identifier, depth first, so a test reads a chain's whole shape at once. */
function idsOf(slots: readonly ChainSlot[]): string[] {
  return slots.flatMap((slot) =>
    slot.kind === 'processor'
      ? [slot.id]
      : [slot.id, ...slot.branches.flatMap((branch) => ['|', ...idsOf(branch.slots), '|'])],
  );
}

const A = processor('aaaa');
const B = processor('bbbb');
const C = processor('cccc');
const D = processor('dddd');
const INNER = group('2222', [D]);
const OUTER = group('1111', [B], [C, INNER]);
const CHAIN: EffectChain = { id: CHAIN_ID, slots: [A, OUTER] };

describe('findSlot', () => {
  it('finds a slot at the top, in a branch and in a group inside a branch, with its place', () => {
    expect(findSlot(CHAIN, A.id)).toEqual({ slot: A, place: { index: 0 } });
    expect(findSlot(CHAIN, C.id)).toEqual({
      slot: C,
      place: { group: { id: OUTER.id, branch: 1 }, index: 0 },
    });
    expect(findSlot(CHAIN, D.id)).toEqual({
      slot: D,
      place: { group: { id: INNER.id, branch: 0 }, index: 0 },
    });
    expect(findSlot(CHAIN, INNER.id)?.place).toEqual({
      group: { id: OUTER.id, branch: 1 },
      index: 1,
    });
  });

  it('answers undefined for a slot the chain does not have', () => {
    expect(findSlot(CHAIN, '22222222-ffff')).toBeUndefined();
  });
});

describe('withSlotAt', () => {
  const E = processor('eeee');

  it('places a slot at the top and inside a nested branch, leaving every other slot where it was', () => {
    expect(idsOf(withSlotAt(CHAIN, { index: 2 }, E)?.slots ?? [])).toEqual([
      A.id,
      OUTER.id,
      '|',
      B.id,
      '|',
      '|',
      C.id,
      INNER.id,
      '|',
      D.id,
      '|',
      '|',
      E.id,
    ]);
    const nestedPlace = { group: { id: INNER.id, branch: 0 }, index: 0 };
    expect(idsOf(withSlotAt(CHAIN, nestedPlace, E)?.slots ?? [])).toEqual([
      A.id,
      OUTER.id,
      '|',
      B.id,
      '|',
      '|',
      C.id,
      INNER.id,
      '|',
      E.id,
      D.id,
      '|',
      '|',
    ]);
  });

  it('keeps the chain’s other members, so a placed slot does not lose the chain its identifier', () => {
    expect(withSlotAt(CHAIN, { index: 0 }, E)?.id).toBe(CHAIN_ID);
  });

  it('refuses a place past the list’s end, before its start, between slots, or in a group or branch the chain lacks', () => {
    expect(withSlotAt(CHAIN, { index: 3 }, E)).toBeUndefined();
    expect(withSlotAt(CHAIN, { index: -1 }, E)).toBeUndefined();
    expect(withSlotAt(CHAIN, { index: 0.5 }, E)).toBeUndefined();
    expect(withSlotAt(CHAIN, { group: { id: OUTER.id, branch: 2 }, index: 0 }, E)).toBeUndefined();
    expect(
      withSlotAt(
        CHAIN,
        { group: { id: unsafeBrandId<'ProcessorGroupId'>('44444444-ffff'), branch: 0 }, index: 0 },
        E,
      ),
    ).toBeUndefined();
  });

  it('leaves the chain it was given unchanged, since a chain is a value an undo still holds', () => {
    const before = idsOf(CHAIN.slots);
    withSlotAt(CHAIN, { group: { id: INNER.id, branch: 0 }, index: 1 }, E);
    expect(idsOf(CHAIN.slots)).toEqual(before);
  });
});

describe('withoutSlot and withSlotReplaced', () => {
  it('removes a slot from inside a nested group and no other', () => {
    expect(idsOf(withoutSlot(CHAIN, D.id)?.slots ?? [])).toEqual([
      A.id,
      OUTER.id,
      '|',
      B.id,
      '|',
      '|',
      C.id,
      INNER.id,
      '|',
      '|',
      '|',
    ]);
    expect(withoutSlot(CHAIN, '22222222-ffff')).toBeUndefined();
  });

  it('replaces a nested slot where it stands by its identifier', () => {
    const louder: ProcessorInstance = { ...C, mix: 0.25 };
    const replaced = withSlotReplaced(CHAIN, louder);
    expect(findSlot(replaced ?? CHAIN, C.id)).toEqual({
      slot: louder,
      place: { group: { id: OUTER.id, branch: 1 }, index: 0 },
    });
    expect(withSlotReplaced(CHAIN, processor('ffff'))).toBeUndefined();
  });
});

describe('withSlotMoved', () => {
  it('moves a slot out of a group to the top, its place stated as the chain stands without it', () => {
    const moved = withSlotMoved(CHAIN, D.id, { index: 0 });
    expect(idsOf(moved?.slots ?? [])).toEqual([
      D.id,
      A.id,
      OUTER.id,
      '|',
      B.id,
      '|',
      '|',
      C.id,
      INNER.id,
      '|',
      '|',
      '|',
    ]);
  });

  it('moves a slot later in its own list by the index the list has once it is out', () => {
    const flat: EffectChain = { id: CHAIN_ID, slots: [A, B, C] };
    expect(idsOf(withSlotMoved(flat, A.id, { index: 2 })?.slots ?? [])).toEqual([B.id, C.id, A.id]);
  });

  it('refuses to move a group into itself or into a group inside it, which would lose it from the chain', () => {
    expect(
      withSlotMoved(CHAIN, OUTER.id, { group: { id: OUTER.id, branch: 0 }, index: 0 }),
    ).toBeUndefined();
    expect(
      withSlotMoved(CHAIN, OUTER.id, { group: { id: INNER.id, branch: 0 }, index: 0 }),
    ).toBeUndefined();
  });

  it('moves a group into a group beside it, which is not inside it', () => {
    const beside = group('3333', []);
    const chain: EffectChain = { id: CHAIN_ID, slots: [INNER, beside] };
    const moved = withSlotMoved(chain, INNER.id, { group: { id: beside.id, branch: 0 }, index: 0 });
    expect(idsOf(moved?.slots ?? [])).toEqual([beside.id, '|', INNER.id, '|', D.id, '|', '|']);
  });

  it('refuses a slot the chain lacks or a place it lacks, rather than dropping the slot', () => {
    expect(withSlotMoved(CHAIN, '22222222-ffff', { index: 0 })).toBeUndefined();
    expect(withSlotMoved(CHAIN, A.id, { index: 5 })).toBeUndefined();
  });
});

describe('copySlot and copyChain', () => {
  it('mints a new identifier for every slot inside a copied group, so a pasted group shares none', () => {
    const ids = createDeterministicIdGenerator(7);
    const copy = copySlot(OUTER, ids);
    const original = new Set(idsOf([OUTER]).filter((id) => id !== '|'));
    const copied = idsOf([copy]).filter((id) => id !== '|');
    expect(copied).toHaveLength(original.size);
    expect(new Set(copied).size).toBe(copied.length);
    for (const id of copied) expect(original.has(id)).toBe(false);
  });

  it('keeps everything but the identifiers: order, branches, controls and values', () => {
    const tuned: ProcessorInstance = {
      ...instantiateProcessor(unsafeBrandId<'ProcessorId'>('22222222-9999'), TEST_LIMITER),
      values: new Map([[LOOK_AHEAD, 96]]),
      mix: 0.75,
      enabled: false,
    };
    const source: EffectChain = { id: CHAIN_ID, slots: [tuned, { ...OUTER, soloed: true }] };
    const copy = copyChain(source, createDeterministicIdGenerator(11));
    expect(copy.id).not.toBe(source.id);
    const strip = (slots: readonly ChainSlot[]): unknown =>
      slots.map((slot) =>
        slot.kind === 'processor'
          ? { ...slot, id: 'x' }
          : { ...slot, id: 'x', branches: slot.branches.map((b) => strip(b.slots)) },
      );
    expect(strip(copy.slots)).toEqual(strip(source.slots));
    const copied = [...processorsOf(copy.slots)].map((each) => each.id);
    expect(copied).toHaveLength(4);
    for (const id of copied) expect([tuned.id, B.id, C.id, D.id]).not.toContain(id);
  });
});
