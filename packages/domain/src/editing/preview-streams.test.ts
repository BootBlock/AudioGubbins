/**
 * The two kinds of processing only a game preview's plan has (ADR-0104): a
 * stream played at a ratio, and a chain's parameters moved along its stream.
 * Each is whole only in the shape the plan states, reads back from a clone as
 * it was, and is refused in a payload a project would keep.
 */

import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '../audio/channel-layout.js';
import { unsafeBrandId } from '../identity/branded-id.js';
import { readValue } from '../messages/message-fields.js';
import { instantiateProcessor, type EffectChain } from '../processing/effect-chain.js';
import type { DomainResult } from '../result.js';
import { CUTOFF, TEST_FILTER } from '../testing/test-processors.js';
import { assetOf, editingEntities, frames } from '../testing/editing-fixtures.js';
import { expectFailureCode, expectSuccess } from '../testing/unwrap.js';
import { shapesOf } from './edit-shape.js';
import { validateOperation } from './operation-validation.js';
import { editPlanOf } from './plan-decoding.js';
import { validatePlan } from './plan-validation.js';
import {
  VARISPEED_DENOMINATOR,
  automationValueAt,
  streamLength,
  type EditPlan,
  type ParameterAutomation,
  type PlanSegment,
  type PlanStream,
} from './plan.js';

const asset = assetOf('f00d', 1_000, [], StandardLayouts.mono);
const ASSETS = new Map([[asset.id, asset]]);
const FILTER = unsafeBrandId<'ProcessorId'>('22222222-f117');
const CHAIN: EffectChain = {
  id: unsafeBrandId<'EffectChainId'>('33333333-f117'),
  slots: [instantiateProcessor(FILTER, TEST_FILTER)],
};

function reading(source: PlanSegment['source'], length: number, start = 0): PlanSegment {
  return { source, start: frames(start), length: frames(length), reversed: false, stages: [] };
}

function media(length: number): PlanStream {
  return {
    sampleRate: asset.sampleRate,
    layout: asset.channelLayout,
    segments: [reading({ kind: 'media', asset: asset.id }, length)],
  };
}

/** A sound reading a varispeed of `numerator` over the asset, `heard` frames of it. */
function varispeedPlan(numerator: number, heard: number, varied?: Partial<PlanStream>): EditPlan {
  return {
    streams: [
      { ...media(heard), segments: [reading({ kind: 'stream', stream: 1 }, heard)] },
      {
        ...media(1_000),
        segments: [reading({ kind: 'stream', stream: 2 }, 1_000)],
        processing: { kind: 'varispeed', numerator, denominator: VARISPEED_DENOMINATOR },
        ...varied,
      },
      media(1_000),
    ],
  };
}

/** A sound reading the asset through the filter, its cutoff moved by `automation`. */
function automatedPlan(automation: readonly ParameterAutomation[]): EditPlan {
  return {
    streams: [
      { ...media(1_000), segments: [reading({ kind: 'stream', stream: 1 }, 1_000)] },
      {
        ...media(1_000),
        processing: { kind: 'chain', chain: CHAIN, input: asset.channelLayout, automation },
      },
    ],
  };
}

const SWEEP: ParameterAutomation = {
  processor: FILTER,
  parameter: CUTOFF,
  points: [
    { frame: 0, value: 200 },
    { frame: 480, value: 2_000 },
  ],
};

function readBack(plan: EditPlan): DomainResult<EditPlan> {
  return readValue(structuredClone(plan), 'editing.plan-unreadable', (one) =>
    editPlanOf(one, 'plan'),
  );
}

describe('a varispeed stream', () => {
  it('plays its segment in as many frames as the canonical resampler makes of it by its steps', () => {
    const faster = varispeedPlan(8_192, 500);
    const slower = varispeedPlan(3_000, 1_366);

    expect(streamLength(faster.streams[1] ?? media(0))).toBe(500);
    // ⌈1,000 · 4,096 / 3,000⌉
    expect(streamLength(slower.streams[1] ?? media(0))).toBe(1_366);
    expectSuccess(validatePlan(faster, ASSETS));
    expectSuccess(validatePlan(slower, ASSETS));
    expect(expectFailureCode(validatePlan(varispeedPlan(3_000, 1_367), ASSETS))).toBe(
      'editing.plan-malformed',
    );
  });

  it('holds a ratio of whole 4,096ths within two octaves either way', () => {
    expectSuccess(validatePlan(varispeedPlan(1_024, 4_000), ASSETS));
    expectSuccess(validatePlan(varispeedPlan(16_384, 250), ASSETS));
    for (const numerator of [1_023, 16_385, 4_096.5]) {
      expect(
        expectFailureCode(validatePlan(varispeedPlan(numerator, 200), ASSETS)),
        String(numerator),
      ).toBe('editing.plan-malformed');
    }
  });

  it('plays one segment of a later stream of its own rate and layout', () => {
    const fromMedia = varispeedPlan(4_096, 1_000, {
      segments: [reading({ kind: 'media', asset: asset.id }, 1_000)],
    });
    const twoSegments = varispeedPlan(4_096, 1_000, {
      segments: [
        reading({ kind: 'stream', stream: 2 }, 500),
        reading({ kind: 'stream', stream: 2 }, 500, 500),
      ],
    });

    expect(expectFailureCode(validatePlan(fromMedia, ASSETS))).toBe('editing.plan-malformed');
    expect(expectFailureCode(validatePlan(twoSegments, ASSETS))).toBe('editing.plan-malformed');
  });

  it('reads back from a clone as it was, and is refused with another denominator', () => {
    const plan = varispeedPlan(5_000, 820);

    expect(expectSuccess(readBack(plan))).toEqual(plan);
    const other: Record<string, unknown> = { ...structuredClone(plan) };
    const [, varied] = other['streams'] as Record<string, unknown>[];
    if (varied === undefined) throw new Error('The plan has its varispeed stream.');
    varied['processing'] = { kind: 'varispeed', numerator: 5_000, denominator: 4_095 };
    expect(
      expectFailureCode(
        readValue(other, 'editing.plan-unreadable', (one) => editPlanOf(one, 'plan')),
      ),
    ).toBe('editing.plan-unreadable');
  });
});

describe('a chain’s automation in a plan', () => {
  it('is linear between its points and held before the first and after the last', () => {
    const { points } = SWEEP;

    expect(automationValueAt(points, -10)).toBe(200);
    expect(automationValueAt(points, 0)).toBe(200);
    expect(automationValueAt(points, 240)).toBe(1_100);
    expect(automationValueAt(points, 480)).toBe(2_000);
    expect(automationValueAt(points, 10_000)).toBe(2_000);
    expect(automationValueAt([{ frame: 100, value: 7 }], 0)).toBe(7);
  });

  it('moves processors its chain has, by rising whole frames, one lane a parameter', () => {
    expectSuccess(validatePlan(automatedPlan([SWEEP]), ASSETS));
    const refusals: readonly (readonly ParameterAutomation[])[] = [
      [{ ...SWEEP, processor: unsafeBrandId<'ProcessorId'>('22222222-0000') }],
      [SWEEP, SWEEP],
      [{ ...SWEEP, points: [] }],
      [
        {
          ...SWEEP,
          points: [
            { frame: 10, value: 1 },
            { frame: 10, value: 2 },
          ],
        },
      ],
      [{ ...SWEEP, points: [{ frame: -1, value: 1 }] }],
      [{ ...SWEEP, points: [{ frame: 0.5, value: 1 }] }],
      [{ ...SWEEP, points: [{ frame: 0, value: Number.NaN }] }],
    ];
    for (const [index, automation] of refusals.entries()) {
      expect(
        expectFailureCode(validatePlan(automatedPlan(automation), ASSETS)),
        String(index),
      ).toBe('editing.plan-malformed');
    }
  });

  it('reads back from a clone as it was', () => {
    const plan = automatedPlan([SWEEP]);

    expect(expectSuccess(readBack(plan))).toEqual(plan);
  });
});

describe('a payload holding processing only a preview has', () => {
  const shape = shapesOf(asset)[0];
  if (shape === undefined) throw new Error('An asset has its source’s shape.');
  const insert = (payload: EditPlan) =>
    validateOperation(
      {
        id: unsafeBrandId<'EditOperationId'>('0000aaaa-paste'),
        kind: 'insert',
        at: frames(0),
        payload,
      },
      shape,
      editingEntities(ASSETS),
    );

  it('is refused, as a project keeps neither', () => {
    expect(expectFailureCode(insert(varispeedPlan(5_000, 820)))).toBe('editing.payload-varispeed');
    expect(expectFailureCode(insert(automatedPlan([SWEEP])))).toBe('editing.payload-automation');
    expectSuccess(insert({ streams: [media(10)] }));
  });
});
