import { describe, expect, it } from 'vitest';

import { unsafeBrandId, type EffectChainId, type ParameterId } from '../identity/branded-id.js';
import { TEST_FILTER, TEST_LIMITER } from '../testing/test-processors.js';
import { expectFailureCode, expectSuccess } from '../testing/unwrap.js';
import { effectChainFrom } from './chain-decoding.js';
import type { ParameterValue } from './parameter.js';
import { MAXIMUM_CHAIN_SLOTS, MAXIMUM_GROUP_DEPTH } from './chain-validation.js';
import {
  SummingLaw,
  instantiateProcessor,
  type ChainSlot,
  type EffectChain,
  type ParallelGroup,
  type ProcessorInstance,
} from './effect-chain.js';

const CHAIN_ID: EffectChainId = unsafeBrandId<'EffectChainId'>('33333333-aaaa');

// The test processors' own parameter identifiers are readable names rather
// than well-formed identifiers, which a reader rightly refuses, so the values
// here are keyed by identifiers of the form a generator makes.
const CUTOFF: ParameterId = unsafeBrandId<'ParameterId'>('11111111-0c0f');
const GENTLE: ParameterId = unsafeBrandId<'ParameterId'>('11111111-0e17');
const LOOK_AHEAD: ParameterId = unsafeBrandId<'ParameterId'>('11111111-0a4d');

function processor(suffix: string): ProcessorInstance {
  return {
    ...instantiateProcessor(unsafeBrandId<'ProcessorId'>(`22222222-${suffix}`), TEST_FILTER),
    values: new Map<ParameterId, ParameterValue>([
      [CUTOFF, 1_000],
      [GENTLE, false],
    ]),
  };
}

function group(suffix: string, ...branches: (readonly ChainSlot[])[]): ParallelGroup {
  return {
    kind: 'group',
    id: unsafeBrandId<'ProcessorGroupId'>(`44444444-${suffix}`),
    enabled: true,
    soloed: false,
    mix: 1,
    summing: SummingLaw.EqualPower,
    branches: branches.map((slots) => ({ slots })),
  };
}

/** A chain using every member a chain can hold, optional ones included. */
const LIMITER: ProcessorInstance = {
  ...instantiateProcessor(unsafeBrandId<'ProcessorId'>('22222222-bbbb'), TEST_LIMITER),
  values: new Map([[LOOK_AHEAD, 96]]),
  enabled: false,
  soloed: true,
  mix: 0.5,
  version: {
    implementation: 1,
    parameters: 1,
    resampler: 3,
    model: {
      pack: 'deepfilternet-3',
      version: '1.0.0',
      modelHash: 'a'.repeat(64),
      runtimeHash: 'b'.repeat(64),
    },
  },
  state: { kind: 'noise-profile', values: [0.25, -1, 0] },
};
const CHAIN: EffectChain = {
  id: CHAIN_ID,
  slots: [processor('aaaa'), group('cccc', [LIMITER], [], [group('dddd', [processor('eeee')])])],
};

/** The chain as a clone gives it, with `change` made to its fields, read back. */
function readWith(change: (clone: Record<string, unknown>) => void) {
  const clone: Record<string, unknown> = { ...structuredClone(CHAIN) };
  change(clone);
  return effectChainFrom(clone);
}

/** The clone's first slot's fields, for a test to break one. */
function firstSlot(clone: Record<string, unknown>): Record<string, unknown> {
  const slots = clone['slots'] as Record<string, unknown>[];
  const [first] = slots;
  if (first === undefined) throw new Error('The fixture chain has a slot.');
  return first;
}

/** The clone's group's fields. */
function theGroup(clone: Record<string, unknown>): Record<string, unknown> {
  const slots = clone['slots'] as Record<string, unknown>[];
  const [, second] = slots;
  if (second === undefined) throw new Error('The fixture chain has a group.');
  return second;
}

/** The limiter inside the clone's group. */
function theLimiter(clone: Record<string, unknown>): Record<string, unknown> {
  const branches = theGroup(clone)['branches'] as { slots: Record<string, unknown>[] }[];
  const limiter = branches[0]?.slots[0];
  if (limiter === undefined) throw new Error('The fixture chain has a limiter.');
  return limiter;
}

describe('effectChainFrom', () => {
  it('reads a structured clone of a chain back as the chain, every member and optional member kept', () => {
    expect(expectSuccess(effectChainFrom(structuredClone(CHAIN)))).toEqual(CHAIN);
  });

  it('keeps an optional member absent where the chain had none, so a read chain equals its source', () => {
    const plain: EffectChain = { id: CHAIN_ID, slots: [processor('aaaa')] };
    const read = expectSuccess(effectChainFrom(structuredClone(plain)));
    expect(read).toEqual(plain);
    const [slot] = read.slots;
    expect(slot !== undefined && 'state' in slot).toBe(false);
  });

  const malformed: readonly (readonly [string, (clone: Record<string, unknown>) => void])[] = [
    ['a chain identifier that is not one', (clone) => (clone['id'] = 'NOT AN ID')],
    ['slots that are not a list', (clone) => (clone['slots'] = { 0: 'slot' })],
    ['a slot that is not a record', (clone) => ((clone['slots'] as unknown[])[0] = 'slot')],
    ['a slot of an unknown kind', (clone) => (firstSlot(clone)['kind'] = 'plugin')],
    ['a processor identifier that is not one', (clone) => (firstSlot(clone)['id'] = 42)],
    ['an empty type key', (clone) => (firstSlot(clone)['typeKey'] = '')],
    ['a type key past its bound', (clone) => (firstSlot(clone)['typeKey'] = 'k'.repeat(257))],
    ['a bypass that is not a flag', (clone) => (firstSlot(clone)['enabled'] = 'yes')],
    ['a solo that is not a flag', (clone) => (firstSlot(clone)['soloed'] = 1)],
    ['a mix that is not finite', (clone) => (firstSlot(clone)['mix'] = Number.NaN)],
    ['a version that is not a record', (clone) => (firstSlot(clone)['version'] = 1)],
    [
      'an implementation version that is not whole',
      (clone) => (firstSlot(clone)['version'] = { implementation: 1.5, parameters: 1 }),
    ],
    [
      'a negative parameter schema version',
      (clone) => (firstSlot(clone)['version'] = { implementation: 1, parameters: -1 }),
    ],
    [
      'a resampler version that is not whole',
      (clone) =>
        (theLimiter(clone)['version'] = { implementation: 1, parameters: 1, resampler: '3' }),
    ],
    [
      'a model with an empty pack',
      (clone) =>
        (theLimiter(clone)['version'] = {
          implementation: 1,
          parameters: 1,
          model: { pack: '', version: '1', modelHash: 'a', runtimeHash: 'b' },
        }),
    ],
    ['values that are not a map', (clone) => (firstSlot(clone)['values'] = { [CUTOFF]: 1_000 })],
    [
      'a value that is not a number, a word or a flag',
      (clone) => (firstSlot(clone)['values'] = new Map([[CUTOFF, { hertz: 1_000 }]])),
    ],
    [
      'a value that is not finite',
      (clone) => (firstSlot(clone)['values'] = new Map([[CUTOFF, Number.POSITIVE_INFINITY]])),
    ],
    [
      'a parameter identifier that is not one',
      (clone) => (firstSlot(clone)['values'] = new Map([['Not An Id', 1]])),
    ],
    [
      'more values than any processor has',
      (clone) =>
        (firstSlot(clone)['values'] = new Map(
          Array.from({ length: 1_025 }, (_, index) => [`11111111-${String(index)}`, 0]),
        )),
    ],
    ['a state that is not a record', (clone) => (theLimiter(clone)['state'] = [1, 2])],
    ['a state with no kind', (clone) => (theLimiter(clone)['state'] = { kind: '', values: [1] })],
    [
      'a state value that is not finite',
      (clone) => (theLimiter(clone)['state'] = { kind: 'profile', values: [1, Number.NaN] }),
    ],
    ['a group of an unknown summing law', (clone) => (theGroup(clone)['summing'] = 'loudest')],
    ['a group identifier that is not one', (clone) => (theGroup(clone)['id'] = null)],
    ['a group bypass that is not a flag', (clone) => (theGroup(clone)['enabled'] = 0)],
    ['a group mix that is not a number', (clone) => (theGroup(clone)['mix'] = '1')],
    ['branches that are not a list', (clone) => (theGroup(clone)['branches'] = { slots: [] })],
    ['a branch that is not a record', (clone) => (theGroup(clone)['branches'] = [[]])],
    ['a branch whose slots are not a list', (clone) => (theGroup(clone)['branches'] = [{}])],
  ];

  it.each(malformed)(
    'refuses %s rather than handing a worker a chain it cannot trust',
    (_, change) => {
      expect(expectFailureCode(readWith(change))).toBe('effect-chain.unreadable');
    },
  );

  it('refuses a value that is not a record at all', () => {
    for (const value of [undefined, null, 7, 'chain', [CHAIN], new Map()]) {
      expect(expectFailureCode(effectChainFrom(value))).toBe('effect-chain.unreadable');
    }
  });

  it('refuses a chain whose shape fails, after reading, by the rule every chain is held to', () => {
    const twice: EffectChain = { id: CHAIN_ID, slots: [processor('aaaa'), processor('aaaa')] };
    expect(expectFailureCode(effectChainFrom(structuredClone(twice)))).toBe(
      'effect-chain.malformed',
    );
  });

  /** A group nested `depth` deep as a clone holds it, built without recursion. */
  function deeplyNested(depth: number): unknown {
    let slot: unknown = structuredClone(processor('aaaa'));
    for (let level = 0; level < depth; level += 1) {
      slot = {
        kind: 'group',
        id: `44444444-${level.toString(16)}`,
        enabled: true,
        soloed: false,
        mix: 1,
        summing: 'sum',
        branches: [{ slots: [slot] }],
      };
    }
    return { id: CHAIN_ID, slots: [slot] };
  }

  it('reads groups nested to the bound, and refuses one deeper', () => {
    expectSuccess(effectChainFrom(deeplyNested(MAXIMUM_GROUP_DEPTH)));
    expect(expectFailureCode(effectChainFrom(deeplyNested(MAXIMUM_GROUP_DEPTH + 1)))).toBe(
      'effect-chain.unreadable',
    );
  });

  it('refuses groups nested ten thousand deep by its bounds, not by overflowing the stack', () => {
    expect(expectFailureCode(effectChainFrom(deeplyNested(10_000)))).toBe(
      'effect-chain.unreadable',
    );
  });

  it('reads a chain of as many slots as the bound and refuses one more, counting those in groups', () => {
    const many = (count: number): ProcessorInstance[] =>
      Array.from({ length: count }, (_, index) => processor(`f${index.toString(16)}`));
    expectSuccess(
      effectChainFrom(structuredClone({ id: CHAIN_ID, slots: many(MAXIMUM_CHAIN_SLOTS) })),
    );
    const inGroup: EffectChain = {
      id: CHAIN_ID,
      slots: [group('aaaa', many(MAXIMUM_CHAIN_SLOTS))],
    };
    expect(expectFailureCode(effectChainFrom(structuredClone(inGroup)))).toBe(
      'effect-chain.unreadable',
    );
  });
});
