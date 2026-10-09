import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '../audio/channel-layout.js';
import { readValue } from '../messages/message-fields.js';
import { assetOf, frames, OTHER_RATE } from '../testing/editing-fixtures.js';
import { expectFailureCode, expectSuccess } from '../testing/unwrap.js';
import { editPlanOf } from './plan-decoding.js';
import { validatePlan } from './plan-validation.js';
import { sourceStreams, type EditPlan, type PlanSource, type PlanStream } from './plan.js';
import { sumInto } from './stage-arithmetic.js';
import { pruneStreams, shiftStreams } from './stream-tables.js';

const ASSET = assetOf('source', 100);
const ASSETS = new Map([[ASSET.id, ASSET]]);

function stream(source: PlanSource, length = 10, rate = ASSET.sampleRate): PlanStream {
  return {
    sampleRate: rate,
    layout: StandardLayouts.stereo,
    segments: [{ source, start: frames(0), length: frames(length), reversed: false, stages: [] }],
  };
}

const MEDIA: PlanSource = { kind: 'media', asset: ASSET.id };

function mixing(
  streams: readonly number[],
  length = 10,
  others = [stream(MEDIA), stream(MEDIA)],
): EditPlan {
  return { streams: [stream({ kind: 'mix', streams }, length), ...others] };
}

function problem(plan: EditPlan): string {
  const result = validatePlan(plan, ASSETS);
  if (result.ok) throw new Error('Expected a refusal.');
  return result.failures[0].summary;
}

describe('a mix of streams', () => {
  it('reads the same frames of two or more later streams of its rate and one layout', () => {
    expectSuccess(validatePlan(mixing([1, 2]), ASSETS));
    expect(problem(mixing([1]))).toBe('A mix sums two or more streams.');
    expect(problem(mixing([0, 1]))).toBe('A mix reads a stream that does not follow its own.');
    expect(problem(mixing([1, 3]))).toBe('A mix reads a stream that does not follow its own.');
    expect(problem(mixing([1, 2], 11))).toBe('A segment reads past the end of its source.');
    const slow = { ...stream({ kind: 'silence', channels: 2 }), sampleRate: OTHER_RATE };
    expect(problem(mixing([1, 2], 10, [stream(MEDIA), slow]))).toBe(
      'A mix reads a stream at another rate.',
    );
    const mono: PlanStream = {
      ...stream({ kind: 'silence', channels: 1 }),
      layout: StandardLayouts.mono,
    };
    expect(problem(mixing([1, 2], 10, [stream(MEDIA), mono]))).toBe(
      'A mix sums streams of different layouts.',
    );
  });

  it('counts its streams as read, and moves with them when they are renumbered', () => {
    expect(sourceStreams({ kind: 'mix', streams: [1, 2] })).toEqual([1, 2]);
    const shifted = shiftStreams(mixing([1, 2]).streams, 3);
    expect(shifted[0].segments[0]?.source).toEqual({ kind: 'mix', streams: [4, 5] });
    const unread = { streams: [...mixing([1, 3]).streams, stream(MEDIA)] } satisfies EditPlan;
    const pruned = pruneStreams(unread);
    expect(pruned.streams).toHaveLength(3);
    expect(pruned.streams[0].segments[0]?.source).toEqual({ kind: 'mix', streams: [1, 2] });
  });

  it('crosses a thread as it was', () => {
    const silence = stream({ kind: 'silence', channels: 2 });
    const plan = mixing([1, 2], 10, [silence, silence]);
    expect(
      expectSuccess(
        readValue(structuredClone(plan), 'editing.plan-unreadable', (one) =>
          editPlanOf(one, 'plan'),
        ),
      ),
    ).toEqual(plan);
    const malformed = {
      streams: [stream({ kind: 'mix', streams: [1.5, 2] }), ...plan.streams.slice(1)],
    };
    expect(
      expectFailureCode(
        readValue(malformed, 'editing.plan-unreadable', (one) => editPlanOf(one, 'plan')),
      ),
    ).toBe('editing.plan-unreadable');
  });

  it('sums in order, rounding each addition to a 32-bit float', () => {
    const sum = [Float32Array.of(1, 0.1, -0)];
    sumInto(sum, [Float32Array.of(2 ** -24, 0.2, 0)], 3);
    expect([...(sum[0] ?? [])]).toEqual([1, Math.fround(Math.fround(0.1) + Math.fround(0.2)), 0]);
  });
});
