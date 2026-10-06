import { describe, expect, it } from 'vitest';

import { StandardLayouts, type ChannelLayout } from '../audio/channel-layout.js';
import { unsafeBrandId, type EffectChainId } from '../identity/branded-id.js';
import {
  TEST_CATALOGUE,
  TEST_FILTER,
  TEST_LIMITER,
  TEST_UPMIXER,
} from '../testing/test-processors.js';
import { expectFailureCode, expectSuccess } from '../testing/unwrap.js';
import {
  MAXIMUM_CHAIN_SLOTS,
  MAXIMUM_GROUP_BRANCHES,
  MAXIMUM_GROUP_DEPTH,
  chainOutputLayout,
  validateChainShape,
} from './chain-validation.js';
import {
  SummingLaw,
  instantiateProcessor,
  type ChainSlot,
  type EffectChain,
  type ParallelGroup,
  type ProcessorInstance,
} from './effect-chain.js';
import type { ProcessorDescriptor } from './processor-descriptor.js';
import { MAXIMUM_STATE_VALUES, type ProcessorState } from './processor-version.js';
import { sampleRate } from '../time/sample-time.js';
import { FailureKind, fail, failure, succeed } from '../result.js';

const CHAIN_ID: EffectChainId = unsafeBrandId<'EffectChainId'>('33333333-aaaa');

function processor(
  suffix: string,
  descriptor: ProcessorDescriptor = TEST_FILTER,
): ProcessorInstance {
  return instantiateProcessor(unsafeBrandId<'ProcessorId'>(`22222222-${suffix}`), descriptor);
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

function chainOf(...slots: ChainSlot[]): EffectChain {
  return { id: CHAIN_ID, slots };
}

/** `count` filters, each with its own identifier. */
function filters(count: number, prefix = 'f'): ProcessorInstance[] {
  return Array.from({ length: count }, (_, index) => processor(`${prefix}${String(index)}`));
}

/** A group `depth` deep: groups inside groups, a filter in the innermost. */
function nested(depth: number): ChainSlot {
  let slot: ChainSlot = processor('deep');
  for (let level = 0; level < depth; level += 1) slot = group(`g${String(level)}`, [slot]);
  return slot;
}

function shapeRefusal(chain: EffectChain): { code: string; at: unknown } {
  const result = validateChainShape(chain);
  if (result.ok) throw new Error('Expected the chain’s shape to be refused.');
  return { code: result.failures[0].code, at: result.failures[0].details?.['at'] };
}

describe('validateChainShape', () => {
  it('accepts a chain with groups, a dry branch and a stated mix, so a sound rack is never refused', () => {
    const chain = chainOf(
      processor('aaaa'),
      group('bbbb', [{ ...processor('cccc', TEST_LIMITER), mix: 0.5 }], []),
    );
    expect(expectSuccess(validateChainShape(chain))).toBe(chain);
  });

  it('refuses two slots of one identifier even where one is inside a group, so a find never picks the wrong slot', () => {
    const top = processor('aaaa');
    expect(shapeRefusal(chainOf(top, group('bbbb', [top]))).code).toBe('effect-chain.malformed');
    expect(shapeRefusal(chainOf(group('bbbb', [top], [top]))).at).toBe('slots/0/branches/1/0');
  });

  it('refuses a mix below 0, above 1 or not a number, which no mixer can apply', () => {
    for (const mix of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(shapeRefusal(chainOf({ ...processor('aaaa'), mix })).code).toBe(
        'effect-chain.malformed',
      );
      expect(shapeRefusal(chainOf({ ...group('bbbb', []), mix })).code).toBe(
        'effect-chain.malformed',
      );
    }
    expectSuccess(validateChainShape(chainOf({ ...processor('aaaa'), mix: 0 })));
  });

  it('refuses a processor’s state past its bound or holding a value that is not finite', () => {
    const at = (values: readonly number[]): EffectChain =>
      chainOf({ ...processor('aaaa'), state: { kind: 'noise-profile', values } });
    expectSuccess(validateChainShape(at(new Array<number>(MAXIMUM_STATE_VALUES).fill(0))));
    expect(shapeRefusal(at(new Array<number>(MAXIMUM_STATE_VALUES + 1).fill(0))).code).toBe(
      'effect-chain.malformed',
    );
    expect(shapeRefusal(at([0, Number.NaN])).code).toBe('effect-chain.malformed');
    expect(shapeRefusal(at([Number.NEGATIVE_INFINITY])).code).toBe('effect-chain.malformed');
  });

  it('refuses a group with no branch or more than its bound, so a sum always has a term', () => {
    expect(shapeRefusal(chainOf(group('aaaa'))).code).toBe('effect-chain.malformed');
    const most = Array.from({ length: MAXIMUM_GROUP_BRANCHES }, (): readonly ChainSlot[] => []);
    expectSuccess(validateChainShape(chainOf(group('bbbb', ...most))));
    expect(shapeRefusal(chainOf(group('cccc', ...most, []))).code).toBe('effect-chain.malformed');
  });

  it('accepts groups nested to the bound and refuses one deeper, at the group that goes past it', () => {
    expectSuccess(validateChainShape(chainOf(nested(MAXIMUM_GROUP_DEPTH))));
    const refusal = shapeRefusal(chainOf(nested(MAXIMUM_GROUP_DEPTH + 1)));
    expect(refusal.code).toBe('effect-chain.malformed');
    expect(refusal.at).toBe(`slots/0${'/branches/0/0'.repeat(MAXIMUM_GROUP_DEPTH)}`);
  });

  it('counts the slots inside groups towards the bound on a chain’s size, not only the top list', () => {
    expectSuccess(validateChainShape(chainOf(...filters(MAXIMUM_CHAIN_SLOTS))));
    // The group is one slot and its processors the rest: one past the bound,
    // though the chain's own list holds a single slot.
    const inside = chainOf(group('aaaa', filters(MAXIMUM_CHAIN_SLOTS)));
    expect(shapeRefusal(inside).code).toBe('effect-chain.malformed');
  });
});

/** The rate a chain is checked at. */
const RATE = expectSuccess(sampleRate(48_000));

/** A filter that cannot run without a profile learned at the rate it runs at. */
const PROFILED: ProcessorDescriptor = {
  ...TEST_FILTER,
  typeKey: 'test-profiled',
  state: {
    kind: 'test-profile',
    missing: 'Learn a profile first.',
    check: (state, _input, rate) =>
      state.values[0] === rate
        ? succeed(undefined)
        : fail(
            failure('processor.state-refused', FailureKind.Rejected, 'Learned at another rate.'),
          ),
  },
};

describe('a chain whose processor needs state it does not hold', () => {
  const catalogue = new Map([...TEST_CATALOGUE, [PROFILED.typeKey, PROFILED]]);
  const holding = (state?: ProcessorState): ProcessorInstance => ({
    ...processor('aaaa', PROFILED),
    ...(state === undefined ? {} : { state }),
  });
  const layoutOf = (slot: ProcessorInstance) =>
    chainOutputLayout({ slots: [slot] }, catalogue, StandardLayouts.mono, RATE);

  it('cannot be planned without it, saying what to do', () => {
    const refused = layoutOf(holding());
    expect(expectFailureCode(refused)).toBe('processor.state-missing');
    expect(refused.ok ? undefined : refused.failures[0].summary).toBe('Learn a profile first.');
  });

  it('cannot be planned with state of another kind, which it would not read', () => {
    expect(expectFailureCode(layoutOf(holding({ kind: 'mask', values: [48_000] })))).toBe(
      'processor.state-missing',
    );
  });

  it('is checked at the rate the stream runs at', () => {
    expectSuccess(layoutOf(holding({ kind: 'test-profile', values: [48_000] })));
    expect(expectFailureCode(layoutOf(holding({ kind: 'test-profile', values: [44_100] })))).toBe(
      'processor.state-refused',
    );
  });

  it('is not checked where the slot is off, since nothing runs it', () => {
    expectSuccess(layoutOf({ ...holding(), enabled: false }));
  });
});

describe('chainOutputLayout', () => {
  const mono = StandardLayouts.mono;
  const stereo = StandardLayouts.stereo;

  function layoutOf(input: ChannelLayout, ...slots: ChainSlot[]) {
    return chainOutputLayout({ slots }, TEST_CATALOGUE, input, RATE);
  }

  it('passes the layout through each processor in order, so a filter after an upmixer sees stereo', () => {
    expect(expectSuccess(layoutOf(mono))).toEqual(mono);
    expect(
      expectSuccess(layoutOf(mono, processor('aaaa'), processor('bbbb', TEST_UPMIXER))),
    ).toEqual(stereo);
    // The upmixer takes mono only, so a second one sees the first one's stereo.
    expect(
      expectFailureCode(
        layoutOf(mono, processor('aaaa', TEST_UPMIXER), processor('bbbb', TEST_UPMIXER)),
      ),
    ).toBe('processor.layout-refused');
  });

  it('passes a bypassed or soloed-out slot’s input on unchanged, so it changes no layout', () => {
    const upmixer = processor('aaaa', TEST_UPMIXER);
    expect(expectSuccess(layoutOf(mono, { ...upmixer, enabled: false }))).toEqual(mono);
    expect(expectSuccess(layoutOf(mono, upmixer, { ...processor('bbbb'), soloed: true }))).toEqual(
      mono,
    );
    expect(
      expectSuccess(layoutOf(stereo, { ...group('cccc', [upmixer]), enabled: false })),
    ).toEqual(stereo);
  });

  it('still checks a bypassed processor against the catalogue, so a project names nothing this build cannot run', () => {
    const unknown = { ...processor('aaaa'), typeKey: 'from-a-later-build', enabled: false };
    expect(expectFailureCode(layoutOf(mono, unknown))).toBe('effect-chain.unknown-processor-type');
    const later = { ...processor('bbbb'), version: { implementation: 2, parameters: 1 } };
    expect(expectFailureCode(layoutOf(mono, { ...later, enabled: false }))).toBe(
      'processor.version-unknown',
    );
  });

  it('still checks the processors inside a bypassed group against the catalogue, as it does a bypassed processor', () => {
    const unknown = { ...processor('aaaa'), typeKey: 'from-a-later-build' };
    expect(expectFailureCode(layoutOf(mono, { ...group('bbbb', [unknown]), enabled: false }))).toBe(
      'effect-chain.unknown-processor-type',
    );
  });

  it('refuses a slot that changes the layout and mixes its input back in, which has no common channels', () => {
    const upmixer = processor('aaaa', TEST_UPMIXER);
    expect(expectFailureCode(layoutOf(mono, { ...upmixer, mix: 0.5 }))).toBe(
      'effect-chain.mix-across-layouts',
    );
    expect(expectFailureCode(layoutOf(mono, { ...group('bbbb', [upmixer]), mix: 0.5 }))).toBe(
      'effect-chain.mix-across-layouts',
    );
    expect(expectSuccess(layoutOf(mono, { ...processor('cccc'), mix: 0.5 }))).toEqual(mono);
  });

  it('refuses a group whose branches end in different layouts, and agrees where they match', () => {
    expect(
      expectFailureCode(layoutOf(mono, group('aaaa', [processor('bbbb', TEST_UPMIXER)], []))),
    ).toBe('effect-chain.branches-disagree');
    expect(
      expectSuccess(
        layoutOf(
          mono,
          group('aaaa', [processor('bbbb', TEST_UPMIXER)], [processor('cccc', TEST_UPMIXER)]),
        ),
      ),
    ).toEqual(stereo);
  });

  it('refuses a processor type or version the build does not have, wherever it sits', () => {
    const unknown = { ...processor('aaaa'), typeKey: 'from-a-later-build' };
    expect(expectFailureCode(layoutOf(mono, group('bbbb', [], [unknown])))).toBe(
      'effect-chain.unknown-processor-type',
    );
    const later = { ...processor('cccc'), version: { implementation: 1, parameters: 9 } };
    expect(expectFailureCode(layoutOf(mono, later))).toBe('processor.version-unknown');
  });
});
