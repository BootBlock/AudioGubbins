/**
 * A preview plan continued as hand actions arrive (ADR-0104): each extension
 * keeps every stream it had at its place and changes none before the frame it
 * continues from, so the engine's continued programme keeps every sounding
 * voice's readers and the voices that did not change go on bit for bit; and
 * the plan it ends with is the one made of the whole simulation at once.
 */

import { describe, expect, it } from 'vitest';

import {
  StandardLayouts,
  createDeterministicIdGenerator,
  derivedSampleCount,
  segmentsLength,
  unsafeBrandId,
  validatePlan,
  type AssetId,
  type EditPlan,
} from '@audiogubbins/domain';
import { expectSuccess, renderPlan, type Samples } from '@audiogubbins/domain/testing';

import { memberKey } from '../groups/membership.js';
import { DEFAULT_EMITTER_RULES } from '../policy/playback-rules.js';
import {
  MEMBER_RATE_44K,
  PREVIEW_TEST_CATALOGUE,
  VECTOR_RATE,
  emitterId,
  poolMember,
  randomVectorSpec,
  repeatEmitter,
  vectorScenario,
  vectorInput,
  type VectorSpec,
} from '../testing/preview-vectors.js';
import { firstDifference, readsBefore } from '../testing/plan-reach.js';
import { extendPreviewPlan, previewPlan, type PreviewPlan } from './preview-plan.js';
import { simulatePreview, type PreviewSimulation } from './preview-simulation.js';

const LONGEST = 30_000;
const AT_48K = unsafeBrandId<'AssetId'>('0000beef-0048');
const AT_44K = unsafeBrandId<'AssetId'>('0000beef-0044');
const ASSETS = new Map([
  [
    AT_48K,
    {
      sampleRate: VECTOR_RATE,
      channelLayout: StandardLayouts.mono,
      length: derivedSampleCount(LONGEST),
    },
  ],
  [
    AT_44K,
    {
      sampleRate: MEMBER_RATE_44K,
      channelLayout: StandardLayouts.stereo,
      length: derivedSampleCount(LONGEST),
    },
  ],
]);
const ramp = (step: number) =>
  Float32Array.from({ length: LONGEST }, (_, frame) => ((frame % 4_096) + 1) * step);
const MEDIA = new Map<AssetId, Samples>([
  [AT_48K, [ramp(2 ** -13)]],
  [AT_44K, [ramp(2 ** -14), ramp(-(2 ** -14))]],
]);

/** Each member's plan: the start of the asset of its rate, as long as its pool says. */
function membersOf(spec: VectorSpec): ReadonlyMap<string, EditPlan> {
  return new Map(
    spec.emitters.flatMap(({ pool }) =>
      pool.map((member): [string, EditPlan] => {
        const fast = member.sampleRate === VECTOR_RATE;
        return [
          memberKey(member.member),
          {
            streams: [
              {
                sampleRate: member.sampleRate,
                layout: fast ? StandardLayouts.mono : StandardLayouts.stereo,
                segments: [
                  {
                    source: { kind: 'media', asset: fast ? AT_48K : AT_44K },
                    start: derivedSampleCount(0),
                    length: derivedSampleCount(member.length),
                    reversed: false,
                    stages: [],
                  },
                ],
              },
            ],
          },
        ];
      }),
    ),
  );
}

function planned(spec: VectorSpec, simulation: PreviewSimulation): PreviewPlan {
  return expectSuccess(
    previewPlan(
      simulation,
      spec.scenario,
      membersOf(spec),
      PREVIEW_TEST_CATALOGUE,
      createDeterministicIdGenerator(17),
      StandardLayouts.stereo,
    ),
  );
}

describe('a preview plan continued by hand', () => {
  it.each([31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42])(
    'keeps every stream before the frame it continues from, and ends as the whole would (%i)',
    (seed) => {
      const spec = randomVectorSpec(seed);
      let simulation = expectSuccess(simulatePreview(vectorInput({ ...spec, hand: [] })));
      let plan = planned(spec, simulation);
      for (let count = 1; count <= spec.hand.length; count += 1) {
        const hand = spec.hand.slice(0, count);
        const at = hand.at(-1)?.frame ?? 0;
        simulation = expectSuccess(simulatePreview(vectorInput({ ...spec, hand }), simulation));
        const next = expectSuccess(extendPreviewPlan(plan, simulation, at));
        expectSuccess(validatePlan(next.plan, ASSETS));
        // Whatever the old plan read to sound its frames before `at` is there
        // in the new one, at the same place, the same as far as it was read.
        const reach = readsBefore(plan.plan, Math.min(at, plan.build.horizonFrame));
        for (const [place, before] of plan.plan.streams.entries()) {
          const read = Math.min(reach[place] ?? 0, segmentsLength(before));
          if (read === 0) continue;
          const after = next.plan.streams[place];
          expect(after, `stream ${String(place)}`).toBeDefined();
          if (after !== undefined) {
            expect(
              firstDifference(before, after),
              `stream ${String(place)}`,
            ).toBeGreaterThanOrEqual(read);
          }
        }
        for (const [key, stream] of plan.lanes) expect(next.lanes.get(key)).toBe(stream);
        plan = next;
      }
      expect(plan.plan).toEqual(planned(spec, simulation).plan);
    },
  );

  it('frees a voice of a cut the old plan gave it after the frame, where the new events give none', () => {
    // A budget of two: emitter 1's voice and emitter 2's both start at 0, and
    // emitter 2's repeat at 100 ms steals emitter 1's, the oldest. A stop of
    // emitter 2 by hand at 50 ms leaves room, so nothing is stolen at 100 ms.
    const spec: VectorSpec = {
      scenario: vectorScenario(
        [
          repeatEmitter(1, {
            kind: 'repeat',
            intervalMilliseconds: 100,
            jitterMilliseconds: 0,
            count: 1,
          }),
          repeatEmitter(2, {
            kind: 'repeat',
            intervalMilliseconds: 100,
            jitterMilliseconds: 0,
            count: 2,
          }),
        ],
        1,
      ),
      emitters: [
        { rules: DEFAULT_EMITTER_RULES, pool: [poolMember(1, 20_000)] },
        { rules: DEFAULT_EMITTER_RULES, pool: [poolMember(2, 20_000)] },
      ],
      hand: [],
      voiceBudget: 2,
      horizonFrame: 24_000,
    };
    const before = expectSuccess(simulatePreview(vectorInput(spec)));
    expect(before.log.events.some((event) => event.kind === 'budget-stolen')).toBe(true);
    const stopped: VectorSpec = {
      ...spec,
      hand: [{ kind: 'stop', emitter: emitterId(2), frame: 2_400 }],
    };
    const after = expectSuccess(simulatePreview(vectorInput(stopped), before));
    expect(after.log.events.some((event) => event.kind === 'budget-stolen')).toBe(false);
    const continued = expectSuccess(extendPreviewPlan(planned(spec, before), after, 2_400));
    expect(continued.plan).toEqual(planned(stopped, after).plan);
  });

  it('lays a looping voice cut past the plan’s old end as far as it sounds', () => {
    // One voice at a time, the oldest stolen, every 450 ms: the voice of 9.9 s
    // starts a tenth of a second before the plan's end at 10 s, so its run is
    // laid that far and a margin, and the next trigger at 10.35 s cuts it once
    // the end has moved on, 0.45 s into its sound.
    const spec: VectorSpec = {
      scenario: vectorScenario(
        [
          repeatEmitter(1, {
            kind: 'repeat',
            intervalMilliseconds: 450,
            jitterMilliseconds: 0,
            count: 30,
          }),
        ],
        5,
      ),
      emitters: [
        {
          rules: { ...DEFAULT_EMITTER_RULES, voices: { limit: 1, stealing: 'oldest' } },
          pool: [poolMember(1, 4_800, { loop: { start: 0, end: 4_800 } })],
        },
      ],
      hand: [],
      voiceBudget: 4,
      horizonFrame: 477_600,
    };
    const before = expectSuccess(simulatePreview(vectorInput(spec)));
    const plan = planned(spec, before);
    const after = expectSuccess(
      simulatePreview(vectorInput({ ...spec, horizonFrame: 504_000 }), before),
    );

    const continued = expectSuccess(extendPreviewPlan(plan, after, 477_600));

    expect(
      after.log.events.some((event) => event.kind === 'stolen' && event.frame === 496_800),
    ).toBe(true);
    expectSuccess(validatePlan(continued.plan, ASSETS));
  });

  it(
    'sounds the same before the frame it continues from, and the hand trigger from it',
    { timeout: 60_000 },
    () => {
      const base = randomVectorSpec(7);
      const spec: VectorSpec = {
        ...base,
        scenario: { ...base.scenario, emitters: base.scenario.emitters.slice(0, 1) },
        emitters: base.emitters.slice(0, 1),
        hand: [],
        horizonFrame: 48_000,
      };
      const quiet = expectSuccess(simulatePreview(vectorInput(spec)));
      const before = planned(spec, quiet);
      const at = 30_000;
      const emitter = spec.scenario.emitters[0]?.id;
      if (emitter === undefined) throw new Error('The spec has an emitter.');
      const loud = expectSuccess(
        simulatePreview(
          vectorInput({ ...spec, hand: [{ kind: 'trigger', emitter, frame: at }] }),
          quiet,
        ),
      );
      const after = expectSuccess(extendPreviewPlan(before, loud, at));
      const pick = (samples: Samples, ratio: number, length: number): Samples =>
        samples.map((channel) =>
          Float32Array.from({ length }, (_, frame) => channel[Math.floor(frame * ratio)] ?? 0),
        );
      const world = {
        chain: (_chain: unknown, samples: Samples) => samples,
        varispeed: (samples: Samples, numerator: number, denominator: number, length: number) =>
          pick(samples, numerator / denominator, length),
        convert: (samples: Samples, from: number, to: number, length: number) =>
          pick(samples, from / to, length),
      };
      const heardBefore = renderPlan(before.plan, MEDIA, world);
      const heardAfter = renderPlan(after.plan, MEDIA, world);
      expect(loud.log.events.some((event) => event.kind === 'started' && event.frame === at)).toBe(
        true,
      );
      for (const [channel, samples] of heardBefore.entries()) {
        expect(heardAfter[channel]?.subarray(0, at)).toEqual(samples.subarray(0, at));
      }
      expect(heardAfter[0]?.subarray(at)).not.toEqual(heardBefore[0]?.subarray(at));
    },
  );
});
