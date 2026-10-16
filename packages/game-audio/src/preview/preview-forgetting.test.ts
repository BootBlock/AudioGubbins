/**
 * A game preview that plays for many minutes, forgetting what has been heard
 * (ADR-0104): a loop never stopped, moving, beside a sound triggered twenty
 * times a second, its triggers overlapping without a silent moment between.
 *
 * Without forgetting, the plan keeps the streams of every voice it ever laid,
 * the loop's run gains a cycle for every one played and the emitter's motion
 * a point for every waypoint passed, and the simulation keeps a snapshot every
 * 256 actions and every event it made: each grows with the time played, and
 * the plan outgrows what a message may carry in minutes. Forgetting keeps each
 * as large as what is still to be heard, and changes nothing heard from the
 * frame forgotten: the plan sounds the same from there, every stream still
 * sounding stays at its place and reads the same, and a continuation after
 * forgetting keeps every reader of what sounds.
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
import { firstDifference, readsBefore } from '../testing/plan-reach.js';
import {
  MEMBER_RATE_44K,
  PREVIEW_TEST_CATALOGUE,
  VARIED,
  VECTOR_RATE,
  emitterId,
  poolMember,
  repeatEmitter,
  vectorInput,
  vectorScenario,
  type VectorSpec,
} from '../testing/preview-vectors.js';
import {
  extendPreviewPlan,
  forgetPreviewPlanBefore,
  previewPlan,
  type PreviewPlan,
} from './preview-plan.js';
import {
  forgetPreviewBefore,
  simulatePreview,
  type PreviewSimulation,
} from './preview-simulation.js';
import type { HandAction } from './trigger-schedule.js';

const SECOND = 48_000;
const LONGEST = 9_600;
const AT_48K = unsafeBrandId<'AssetId'>('0000f06e-0048');
const AT_44K = unsafeBrandId<'AssetId'>('0000f06e-0044');
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
  Float32Array.from({ length: LONGEST }, (_, frame) => ((frame % 997) + 1) * step);
const MEDIA = new Map<AssetId, Samples>([
  [AT_48K, [ramp(2 ** -11)]],
  [AT_44K, [ramp(2 ** -12), ramp(-(2 ** -12))]],
]);

/**
 * Emitter 1 loops a sound of a tenth of a second, varied in pitch, once and
 * never stopped, moving round the listener every second; emitter 2 plays one of
 * two sounds of a tenth of a second, one at 44.1 kHz, every 50 ms with jitter,
 * four at a time, for `seconds`.
 */
function busy(seconds: number): VectorSpec {
  const loop = poolMember(1, 4_800, {
    variation: VARIED,
    loop: { start: 1_200, end: 4_400 },
  });
  return {
    scenario: vectorScenario(
      [
        repeatEmitter(
          1,
          { kind: 'repeat', intervalMilliseconds: 1_000, jitterMilliseconds: 0, count: 1 },
          {
            motion: {
              kind: 'waypoints',
              points: [
                { at: { x: -2, y: 0, z: -1 }, milliseconds: 0 },
                { at: { x: 2, y: 0, z: -1 }, milliseconds: 500 },
                { at: { x: -2, y: 0, z: -1 }, milliseconds: 1_000 },
              ],
              repeat: 'loop',
            },
          },
        ),
        repeatEmitter(2, {
          kind: 'repeat',
          intervalMilliseconds: 50,
          jitterMilliseconds: 10,
          count: seconds * 20,
        }),
      ],
      29,
    ),
    emitters: [
      { rules: DEFAULT_EMITTER_RULES, pool: [loop] },
      {
        rules: { ...DEFAULT_EMITTER_RULES, voices: { limit: 4, stealing: 'oldest' } },
        pool: [
          poolMember(2, 4_800, { variation: VARIED }),
          poolMember(3, 4_410, { variation: VARIED, sampleRate: MEMBER_RATE_44K }),
        ],
      },
    ],
    hand: [],
    voiceBudget: 16,
    horizonFrame: SECOND,
  };
}

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

/** A run of `spec`: its simulation and plan, as a preview's run keeps them. */
interface Run {
  readonly spec: VectorSpec;
  readonly simulation: PreviewSimulation;
  readonly plan: PreviewPlan;
}

function started(spec: VectorSpec): Run {
  const simulation = expectSuccess(simulatePreview(vectorInput(spec)));
  const plan = expectSuccess(
    previewPlan(
      simulation,
      spec.scenario,
      membersOf(spec),
      PREVIEW_TEST_CATALOGUE,
      createDeterministicIdGenerator(17),
      StandardLayouts.stereo,
    ),
  );
  return { spec, simulation, plan };
}

/** `run` continued to `horizon`, with `hand` added, from the first frame either changes. */
function continuedTo(run: Run, horizon: number, hand: readonly HandAction[] = []): Run {
  const from = Math.min(run.simulation.log.horizonFrame, ...hand.map((action) => action.frame));
  const input = vectorInput({
    ...run.spec,
    hand: [...run.simulation.state.hand, ...hand],
    horizonFrame: horizon,
  });
  const simulation = expectSuccess(simulatePreview(input, run.simulation));
  return { ...run, simulation, plan: expectSuccess(extendPreviewPlan(run.plan, simulation, from)) };
}

/** `run` with everything before `frame` forgotten. */
function forgotten(run: Run, frame: number): Run {
  return {
    ...run,
    simulation: expectSuccess(forgetPreviewBefore(run.simulation, frame)),
    plan: expectSuccess(forgetPreviewPlanBefore(run.plan, frame)),
  };
}

/** How large `run` is: its plan's streams, segments and automation points, and its simulation's log and state. */
function sizeOf(run: Run) {
  const { streams } = run.plan.plan;
  return {
    streams: streams.length,
    segments: streams.reduce((sum, stream) => sum + stream.segments.length, 0),
    points: streams.reduce(
      (sum, stream) =>
        sum +
        (stream.processing?.kind === 'chain'
          ? (stream.processing.automation ?? []).reduce(
              (lanes, lane) => lanes + lane.points.length,
              0,
            )
          : 0),
      0,
    ),
    events: run.simulation.log.events.length,
    // What the state holds, its snapshots and hand actions among it.
    state: JSON.stringify(run.simulation.state).length,
  };
}

describe('a preview forgetting what has been heard', () => {
  it(
    'holds a plan and a simulation no larger after eight minutes than after two',
    { timeout: 240_000 },
    () => {
      // A second laid at a time as a run lays it, forgetting all but the last
      // two seconds each five, as a run forgets behind what the listener hears.
      const minutes = 8;
      let run = started(busy(minutes * 60));
      const empty = () => ({ streams: 0, segments: 0, points: 0, events: 0, state: 0 });
      // The most each grew to in the second minute, and in the last two.
      const early = empty();
      const late = empty();
      for (let second = 1; second < minutes * 60; second += 1) {
        run = continuedTo(run, (second + 1) * SECOND);
        if (second % 5 === 0) run = forgotten(run, (second - 2) * SECOND);
        const size = sizeOf(run);
        const most = second > 60 && second <= 120 ? early : second > 360 ? late : undefined;
        if (most === undefined) continue;
        for (const key of Object.keys(most) as (keyof typeof most)[]) {
          most[key] = Math.max(most[key], size[key]);
        }
      }
      expectSuccess(validatePlan(run.plan.plan, ASSETS));
      // The loop started at 0 still sounds, so nothing was ever silent.
      expect(run.plan.build.horizonFrame).toBe(minutes * 60 * SECOND);
      for (const key of Object.keys(late) as (keyof typeof late)[]) {
        expect(late[key], key).toBeLessThanOrEqual(Math.ceil(early[key] * 1.1));
      }
      // Far within what a message carries to the engine (4,096 streams).
      expect(late.streams).toBeLessThan(1_024);
    },
  );

  it(
    'sounds the same from the frame forgotten, and goes on into a hand trigger after it alike',
    { timeout: 120_000 },
    () => {
      let whole = started(busy(4));
      for (let second = 1; second <= 2; second += 1) {
        whole = continuedTo(whole, (second + 1) * SECOND);
      }
      const frame = (3 * SECOND) / 2;
      const kept = forgotten(whole, frame);
      expectSuccess(validatePlan(kept.plan.plan, ASSETS));

      // Every stream that sounds from the frame is where it was and reads the
      // same from where it says it remembers; every other holds a place alone.
      const before = whole.plan.plan.streams;
      const after = kept.plan.plan.streams;
      const placesAlone = after.filter(
        (stream) => stream.forgottenBefore === segmentsLength(stream),
      );
      expect(placesAlone.length).toBeGreaterThan(0);
      const reach = readsBefore(kept.plan.plan, 3 * SECOND);
      for (const [place, stream] of after.entries()) {
        if ((reach[place] ?? 0) === 0) continue;
        const was = before[place];
        expect(was, `stream ${String(place)}`).toBeDefined();
        if (was !== undefined) {
          expect(firstDifference(was, stream), `stream ${String(place)}`).toBe(
            Number.POSITIVE_INFINITY,
          );
        }
      }

      // A hand trigger after it: the continuation keeps, at its place, every
      // stream the forgotten plan read before the trigger, as far as it read
      // it, and both runs sound alike from the frame forgotten.
      const at = 2 * SECOND + 1_234;
      const trigger: HandAction = { kind: 'trigger', emitter: emitterId(2), frame: at };
      const wholeAfter = continuedTo(whole, 3 * SECOND, [trigger]);
      const keptAfter = continuedTo(kept, 3 * SECOND, [trigger]);
      expectSuccess(validatePlan(keptAfter.plan.plan, ASSETS));
      const read = readsBefore(kept.plan.plan, at);
      for (const [place, stream] of kept.plan.plan.streams.entries()) {
        const asFar = Math.min(read[place] ?? 0, segmentsLength(stream));
        if (asFar === 0) continue;
        const next = keptAfter.plan.plan.streams[place];
        expect(next, `stream ${String(place)}`).toBeDefined();
        if (next !== undefined) {
          expect(firstDifference(stream, next), `stream ${String(place)}`).toBeGreaterThanOrEqual(
            asFar,
          );
        }
      }
      const pick = (samples: Samples, ratio: number, length: number): Samples =>
        samples.map((channel) =>
          Float32Array.from({ length }, (_, index) => channel[Math.floor(index * ratio)] ?? 0),
        );
      const world = {
        chain: (_chain: unknown, samples: Samples) => samples,
        varispeed: (samples: Samples, numerator: number, denominator: number, length: number) =>
          pick(samples, numerator / denominator, length),
        convert: (samples: Samples, from: number, to: number, length: number) =>
          pick(samples, from / to, length),
      };
      const heardWhole = renderPlan(wholeAfter.plan.plan, MEDIA, world);
      const heardKept = renderPlan(keptAfter.plan.plan, MEDIA, world);
      expect(wholeAfter.simulation.log.events.some((event) => event.frame === at)).toBe(true);
      for (const [channel, samples] of heardWhole.entries()) {
        expect(heardKept[channel]?.subarray(frame)).toEqual(samples.subarray(frame));
      }
    },
  );

  it('refuses to go on from a frame it has forgotten', () => {
    let run = started(busy(4));
    run = forgotten(continuedTo(run, 2 * SECOND), SECOND);
    const early: HandAction = { kind: 'trigger', emitter: emitterId(2), frame: SECOND - 1 };
    const input = vectorInput({
      ...run.spec,
      hand: [...run.simulation.state.hand, early],
      horizonFrame: 2 * SECOND,
    });
    expect(simulatePreview(input, run.simulation).ok).toBe(false);
    expect(extendPreviewPlan(run.plan, run.simulation, SECOND - 1).ok).toBe(false);
  });
});
