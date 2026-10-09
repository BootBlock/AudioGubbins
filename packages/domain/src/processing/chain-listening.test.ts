import { describe, expect, it } from 'vitest';

import { unsafeBrandId } from '../identity/branded-id.js';
import { sampleRate } from '../time/sample-time.js';
import { TEST_FILTER, TEST_LIMITER } from '../testing/test-processors.js';
import { expectSuccess } from '../testing/unwrap.js';
import { appliedProcessors, chainListening } from './chain-listening.js';
import {
  SummingLaw,
  instantiateProcessor,
  type ChainSettings,
  type ChainSlot,
  type ProcessorInstance,
} from './effect-chain.js';
import type { ProcessorDescriptor } from './processor-descriptor.js';
import { MAXIMUM_QUALITY } from './quality-mode.js';

const SETTINGS: ChainSettings = {
  sampleRate: expectSuccess(sampleRate(48_000)),
  quality: MAXIMUM_QUALITY.settings,
};

/** A normaliser, which measures its whole input first. */
const MEASURING: ProcessorDescriptor = {
  ...TEST_FILTER,
  typeKey: 'measuring',
  label: 'Measuring',
  wholePass: true,
  frameGrid: () => 6,
};

/** A model, which cannot keep to the audio thread's schedule. */
const SLOW: ProcessorDescriptor = {
  ...TEST_LIMITER,
  typeKey: 'slow',
  label: 'Slow',
  realTime: false,
  leadIn: () => 900,
  frameGrid: () => 4,
};

const DESCRIPTORS = new Map(
  [TEST_FILTER, TEST_LIMITER, MEASURING, SLOW].map((one) => [one.typeKey, one] as const),
);

function processor(
  descriptor: ProcessorDescriptor,
  suffix: string,
  controls: Partial<ProcessorInstance> = {},
): ProcessorInstance {
  return {
    ...instantiateProcessor(unsafeBrandId<'ProcessorId'>(`aaaaaaaa-${suffix}`), descriptor),
    ...controls,
  };
}

function group(suffix: string, branches: readonly (readonly ChainSlot[])[], enabled = true) {
  return {
    kind: 'group',
    id: unsafeBrandId<'ProcessorGroupId'>(`bbbbbbbb-${suffix}`),
    enabled,
    soloed: false,
    mix: 1,
    summing: SummingLaw.Sum,
    branches: branches.map((slots) => ({ slots })),
  } as const;
}

describe('how a chain is heard (ADR-0061)', () => {
  it('runs a chain of real-time processors live, with every grid', () => {
    const heard = chainListening(
      {
        slots: [
          processor(TEST_FILTER, '0001'),
          group('0001', [[processor(TEST_LIMITER, '0002')], []]),
        ],
      },
      DESCRIPTORS,
      SETTINGS,
    );

    expect(heard).toEqual({ kind: 'live', partWay: { leadIn: 64, frameGrid: 1 } });
  });

  it('adds lead-ins along a list and takes the slowest of a group’s branches', () => {
    // Each filter settles over 64 frames only once what feeds it has: two in
    // series need 128, a branch of two beside a branch of none 128 more.
    const heard = chainListening(
      {
        slots: [
          processor(TEST_FILTER, '0001'),
          processor(TEST_FILTER, '0002'),
          group('0001', [
            [processor(TEST_FILTER, '0003'), processor(TEST_FILTER, '0004')],
            [processor(TEST_LIMITER, '0005')],
            [],
          ]),
          processor(TEST_FILTER, '0006', { enabled: false }),
        ],
      },
      DESCRIPTORS,
      SETTINGS,
    );

    expect(heard).toEqual({ kind: 'live', partWay: { leadIn: 256, frameGrid: 1 } });
  });

  it('hears a chain from a render for each processor that cannot run live, each reason once', () => {
    const heard = chainListening(
      {
        slots: [
          processor(MEASURING, '0001'),
          group('0001', [[processor(SLOW, '0002')], [processor(MEASURING, '0003')]]),
        ],
      },
      DESCRIPTORS,
      SETTINGS,
    );

    expect(heard).toEqual({
      kind: 'rendered',
      partWay: { leadIn: 64 + 900, frameGrid: 12 },
      reason:
        'Measuring measures the whole of its input before it plays anything. Slow cannot keep up with the audio as it plays.',
    });
  });

  it('reads only what the chain applies: a bypassed slot, or one another is soloed over, runs nothing', () => {
    const slots: readonly ChainSlot[] = [
      processor(MEASURING, '0001', { enabled: false }),
      group('0001', [[processor(SLOW, '0002')]], false),
      processor(TEST_FILTER, '0003'),
      group('0002', [[processor(SLOW, '0004'), processor(TEST_LIMITER, '0005', { soloed: true })]]),
    ];

    expect([...appliedProcessors(slots)].map((one) => one.id)).toEqual([
      'aaaaaaaa-0003',
      'aaaaaaaa-0005',
    ]);
    expect(chainListening({ slots }, DESCRIPTORS, SETTINGS).kind).toBe('live');
  });
});
