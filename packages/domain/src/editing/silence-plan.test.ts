import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '../audio/channel-layout.js';
import { readValue } from '../messages/message-fields.js';
import {
  assetOf,
  editingEntities,
  frames,
  operationId,
  OTHER_RATE,
  range,
} from '../testing/editing-fixtures.js';
import { PLAN_WITHOUT_CHAINS } from '../testing/plan-context.js';
import { renderPlan } from '../testing/plan-render.js';
import { expectFailureCode, expectSuccess } from '../testing/unwrap.js';
import { sampleRate } from '../time/sample-time.js';
import { validateChain } from './operation-validation.js';
import type { EditOperation } from './operations.js';
import { assetPlan } from './plan-building.js';
import { editPlanOf } from './plan-decoding.js';
import { slicePlan } from './plan-slicing.js';
import { validatePlan } from './plan-validation.js';
import { planIsSilence, silencePlan, type EditPlan } from './plan.js';

const RATE = expectSuccess(sampleRate(48_000));
const SOURCE = assetOf('source', 1_000);

/** Deterministic stereo samples, none of them zero. */
const SAMPLES = [0, 1].map((channel) =>
  Float32Array.from({ length: 1_000 }, (_, frame) => Math.fround(0.25 + (frame + channel) / 4_000)),
);

/** The bits of each channel, so a −0 is told from a +0. */
function bitsOf(channels: readonly Float32Array[]): number[][] {
  return channels.map((channel) => [
    ...new Uint32Array(channel.buffer, channel.byteOffset, channel.length),
  ]);
}

function inserting(
  at: number,
  length: number,
): Extract<EditOperation, { readonly kind: 'insert' }> {
  return {
    id: operationId('silence'),
    kind: 'insert',
    at: frames(at),
    payload: silencePlan(RATE, StandardLayouts.stereo, frames(length)),
  };
}

/** A plan with one segment whose source is `source`, as a document could hold it. */
function planReading(source: unknown): unknown {
  return {
    streams: [
      {
        sampleRate: RATE,
        layout: StandardLayouts.stereo,
        segments: [{ source, start: 0, length: 10, reversed: false, stages: [] }],
      },
    ],
  };
}

describe('generated silence in a plan (REQ-AUDIO-018)', () => {
  it('inserts digital zero of the stated length, and moves what follows on by it', () => {
    const asset = { ...SOURCE, edits: [inserting(400, 250)] };
    expectSuccess(validateChain(asset, editingEntities(new Map([[SOURCE.id, SOURCE]]))));

    const heard = renderPlan(
      expectSuccess(assetPlan(asset, PLAN_WITHOUT_CHAINS)),
      new Map([[SOURCE.id, SAMPLES]]),
    );

    expect(heard[0]?.length).toBe(1_250);
    expect(bitsOf(heard.map((channel) => channel.subarray(400, 650)))).toEqual(
      bitsOf([new Float32Array(250), new Float32Array(250)]),
    );
    expect(bitsOf(heard.map((channel) => channel.subarray(0, 400)))).toEqual(
      bitsOf(SAMPLES.map((channel) => channel.subarray(0, 400))),
    );
    expect(bitsOf(heard.map((channel) => channel.subarray(650)))).toEqual(
      bitsOf(SAMPLES.map((channel) => channel.subarray(400))),
    );
  });

  it('stays silence when sliced, reversed, faded and given a gain', () => {
    const asset: typeof SOURCE = {
      ...SOURCE,
      edits: [
        inserting(0, 300),
        { id: operationId('turn'), kind: 'reverse', range: range(100, 500) },
        {
          id: operationId('fade'),
          kind: 'process',
          range: range(0, 400),
          edit: { kind: 'fade', direction: 'in', shape: 'linear' },
        },
        {
          id: operationId('gain'),
          kind: 'process',
          range: range(0, 400),
          edit: { kind: 'gain', gain: 4 },
        },
      ],
    };
    const plan = expectSuccess(assetPlan(asset, PLAN_WITHOUT_CHAINS));
    const copied = expectSuccess(slicePlan(plan, 300, 400));

    expect(planIsSilence(copied)).toBe(true);
    expect(renderPlan(copied, new Map()).every((channel) => channel.every((x) => x === 0))).toBe(
      true,
    );
  });

  it('reads no asset, so a payload of it is whole in a project of none', () => {
    expectSuccess(validatePlan(silencePlan(RATE, StandardLayouts.stereo, frames(5)), new Map()));
  });

  it('refuses a segment of silence with no channel count a layout may have', () => {
    for (const channels of [0, 257, 1.5, -1]) {
      const plan: EditPlan = {
        streams: [
          {
            sampleRate: RATE,
            layout: StandardLayouts.stereo,
            segments: [
              {
                source: { kind: 'silence', channels },
                start: frames(0),
                length: frames(10),
                reversed: false,
                stages: [],
              },
            ],
          },
        ],
      };
      expect(expectFailureCode(validatePlan(plan, new Map()))).toBe('editing.plan-malformed');
    }
  });

  it('refuses silence whose channels are not its stream’s, or which reads past what a count holds', () => {
    const mono = silencePlan(RATE, StandardLayouts.mono, frames(10));
    const stereoStream = { ...mono.streams[0], layout: StandardLayouts.stereo };
    expect(expectFailureCode(validatePlan({ streams: [stereoStream] }, new Map()))).toBe(
      'editing.plan-malformed',
    );

    const [segment] = mono.streams[0].segments;
    if (segment === undefined) throw new Error('A plan of silence has its segment.');
    const far = {
      streams: [
        { ...mono.streams[0], segments: [{ ...segment, start: frames(Number.MAX_SAFE_INTEGER) }] },
      ],
    } as const;
    expect(expectFailureCode(validatePlan(far, new Map()))).toBe('editing.plan-malformed');
  });

  it('is inserted at the asset’s own rate only: silence at another is refused as other audio is', () => {
    const elsewhere: EditOperation = {
      ...inserting(0, 10),
      payload: silencePlan(OTHER_RATE, StandardLayouts.stereo, frames(10)),
    };
    expect(
      expectFailureCode(
        validateChain({ ...SOURCE, edits: [elsewhere] }, editingEntities(new Map())),
      ),
    ).toBe('editing.payload-rate');
  });

  it('is refused in words that suit any insertion, not a paste’s alone', () => {
    const past: EditOperation = inserting(1_001, 10);
    const outside = validateChain({ ...SOURCE, edits: [past] }, editingEntities(new Map()));
    expect(outside.ok ? [] : outside.failures.map((failure) => failure.summary)).toEqual([
      'The insertion point lies outside the audio.',
    ]);
    const elsewhere: EditOperation = {
      ...inserting(0, 10),
      payload: silencePlan(OTHER_RATE, StandardLayouts.stereo, frames(10)),
    };
    const rate = validateChain({ ...SOURCE, edits: [elsewhere] }, editingEntities(new Map()));
    expect(rate.ok ? [] : rate.failures.map((failure) => failure.summary)).toEqual([
      'The inserted audio is at another sample rate, and is converted only when that is asked for.',
    ]);
  });

  it('crosses a thread as its channel count, and nothing else is a source', () => {
    const read = (value: unknown) =>
      readValue(value, 'editing.plan-unreadable', (one) => editPlanOf(one, 'plan'));

    expect(
      expectSuccess(read(planReading({ kind: 'silence', channels: 2 }))).streams[0].segments[0]
        ?.source,
    ).toEqual({ kind: 'silence', channels: 2 });
    expect(expectFailureCode(read(planReading({ kind: 'noise', channels: 2 })))).toBe(
      'editing.plan-unreadable',
    );
    expect(expectFailureCode(read(planReading({ kind: 'silence' })))).toBe(
      'editing.plan-unreadable',
    );
  });

  it('is told from a plan that reads audio', () => {
    expect(planIsSilence(silencePlan(RATE, StandardLayouts.stereo, frames(3)))).toBe(true);
    expect(planIsSilence(expectSuccess(assetPlan(SOURCE, PLAN_WITHOUT_CHAINS)))).toBe(false);
  });
});
