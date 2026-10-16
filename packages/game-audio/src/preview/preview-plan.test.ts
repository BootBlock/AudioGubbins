/**
 * A preview's plan rendered offline by the domain's plan oracle (ADR-0104):
 * each voice heard at its frame, with its gain, pitch and offset, a stolen
 * voice fading over 5 ms, a loop cycling to the end, each bus at its level and
 * the sound folded to the project's layout. The panner's laws are its own
 * golden tests'; here it passes its input, and a varispeed is a stand-in that
 * reads every `numerator / 4096`-th frame, so a pitch is seen in where each
 * frame comes from.
 */

import { describe, expect, it } from 'vitest';

import {
  StandardLayouts,
  VARISPEED_DENOMINATOR,
  convertedFrameCount,
  createDeterministicIdGenerator,
  derivedSampleCount,
  unsafeBrandId,
  validatePlan,
  type AssetId,
  type ChannelLayout,
  type EditPlan,
  type EffectChain,
  type ParameterValue,
} from '@audiogubbins/domain';
import {
  expectSuccess,
  renderPlan,
  type OracleWorld,
  type Samples,
} from '@audiogubbins/domain/testing';
import { decibelsToGain } from '@audiogubbins/audio-engine';

import { memberKey } from '../groups/membership.js';
import { DEFAULT_EMITTER_RULES, type EmitterRules } from '../policy/playback-rules.js';
import {
  PREVIEW_TEST_CATALOGUE,
  SFX_BUS,
  VECTOR_RATE,
  emitterId,
  poolMember,
  repeatEmitter,
  vectorInput,
  vectorScenario,
  type VectorSpec,
} from '../testing/preview-vectors.js';
import type { StartedEvent } from './preview-event-log.js';
import { previewPlan, type PreviewPlan } from './preview-plan.js';
import { simulatePreview, type PreviewSimulation } from './preview-simulation.js';
import type { PoolMember } from './preview-subjects.js';

const ASSET = unsafeBrandId<'AssetId'>('0000beef-0001');
const SOURCE_FRAMES = 6_000;
/** A mono ramp, every frame its own value, exact in single precision. */
const RAMP = Float32Array.from({ length: SOURCE_FRAMES }, (_, frame) => (frame + 1) / 8_192);
const MEDIA = new Map<AssetId, Samples>([[ASSET, [RAMP]]]);
const ASSETS = new Map([
  [
    ASSET,
    {
      sampleRate: VECTOR_RATE,
      channelLayout: StandardLayouts.mono,
      length: derivedSampleCount(SOURCE_FRAMES),
    },
  ],
]);

/** A member's plan: the ramp's `[start, start + length)`. */
function memberPlan(start: number, length: number): EditPlan {
  return {
    streams: [
      {
        sampleRate: VECTOR_RATE,
        layout: StandardLayouts.mono,
        segments: [
          {
            source: { kind: 'media', asset: ASSET },
            start: derivedSampleCount(start),
            length: derivedSampleCount(length),
            reversed: false,
            stages: [],
          },
        ],
      },
    ],
  };
}

/** The chains of `plan` by identifier. */
function chainsOf(plan: EditPlan): ReadonlyMap<string, EffectChain> {
  return new Map(
    plan.streams.flatMap((stream) =>
      stream.processing?.kind === 'chain'
        ? [[stream.processing.chain.id, stream.processing.chain]]
        : [],
    ),
  );
}

/** The oracle's world: a gain multiplies by its level, the panner passes, a varispeed reads by its ratio. */
function worldOf(plan: EditPlan): OracleWorld {
  const chains = chainsOf(plan);
  return {
    chain: (id, samples) => {
      const [slot] = chains.get(id)?.slots ?? [];
      if (slot?.kind !== 'processor' || slot.typeKey !== 'gain') return samples;
      const level: ParameterValue | undefined = [...slot.values.values()][0];
      const gain = decibelsToGain(typeof level === 'number' ? level : 0);
      return samples.map((channel) => channel.map((value) => Math.fround(value * gain)));
    },
    varispeed: (samples, numerator, denominator, length) =>
      samples.map((channel) =>
        Float32Array.from(
          { length },
          (_, frame) => channel[Math.floor((frame * numerator) / denominator)] ?? 0,
        ),
      ),
  };
}

interface Built {
  readonly simulation: PreviewSimulation;
  readonly plan: PreviewPlan;
  readonly heard: Samples;
}

function built(
  spec: VectorSpec,
  members: ReadonlyMap<string, EditPlan>,
  layout: ChannelLayout = StandardLayouts.stereo,
): Built {
  const simulation = expectSuccess(simulatePreview(vectorInput(spec)));
  const plan = expectSuccess(
    previewPlan(
      simulation,
      spec.scenario,
      members,
      PREVIEW_TEST_CATALOGUE,
      createDeterministicIdGenerator(3),
      layout,
    ),
  );
  expectSuccess(validatePlan(plan.plan, ASSETS));
  return { simulation, plan, heard: renderPlan(plan.plan, MEDIA, worldOf(plan.plan)) };
}

function oneEmitter(
  pool: readonly PoolMember[],
  rules: EmitterRules,
  trigger: Parameters<typeof repeatEmitter>[1],
  horizonFrame = 24_000,
): VectorSpec {
  return {
    scenario: vectorScenario([repeatEmitter(1, trigger)], 21),
    emitters: [{ rules, pool }],
    hand: [],
    voiceBudget: 64,
    horizonFrame,
  };
}

function plansOf(pool: readonly PoolMember[], start = 0): ReadonlyMap<string, EditPlan> {
  return new Map(
    pool.map((member) => [memberKey(member.member), memberPlan(start, member.length)]),
  );
}

const started = (simulation: PreviewSimulation): readonly StartedEvent[] =>
  simulation.log.events.filter((event): event is StartedEvent => event.kind === 'started');

describe('a preview plan', () => {
  it('sounds each voice at its frame, from its offset, at its gain, on both sides', () => {
    const pool = [
      poolMember(1, 1_000, {
        variation: {
          pitchCents: { min: 0, max: 0 },
          gainDecibels: { min: -12, max: 0 },
          startOffsetMilliseconds: { max: 10 },
        },
      }),
    ];
    const spec = oneEmitter(pool, DEFAULT_EMITTER_RULES, {
      kind: 'repeat',
      intervalMilliseconds: 100,
      jitterMilliseconds: 7,
      count: 4,
    });
    const { simulation, plan, heard } = built(spec, plansOf(pool));
    const [left, right] = heard;
    expect(heard).toHaveLength(2);
    expect(left).toHaveLength(spec.horizonFrame);
    const expected = new Float32Array(spec.horizonFrame);
    for (const event of started(simulation)) {
      const gain = decibelsToGain(event.gainDecibels);
      for (let frame = 0; frame < 1_000 - event.offsetFrames; frame += 1) {
        expected[event.frame + frame] = Math.fround((RAMP[event.offsetFrames + frame] ?? 0) * gain);
      }
    }
    expect(left).toEqual(expected);
    expect(right).toEqual(expected);
    expect(plan.media).toEqual([ASSET]);
  });

  it('plays a pitched voice at its ratio, for as many frames as the ratio makes', () => {
    const pool = [
      poolMember(1, 1_200, {
        variation: {
          pitchCents: { min: 700, max: 700 },
          gainDecibels: { min: 0, max: 0 },
          startOffsetMilliseconds: { max: 0 },
        },
      }),
    ];
    const spec = oneEmitter(pool, DEFAULT_EMITTER_RULES, { kind: 'by-hand' });
    const { heard } = built(
      { ...spec, hand: [{ kind: 'trigger', emitter: emitterId(1), frame: 500 }] },
      plansOf(pool),
    );
    const numerator = 6_137; // 4096·2^(700/1200) = 6,137.07
    const length = convertedFrameCount(1_200, numerator, VARISPEED_DENOMINATOR);
    const [left] = heard;
    expect(left?.[499]).toBe(0);
    expect(left?.[500]).toBe(RAMP[0]);
    expect(left?.[600]).toBe(RAMP[Math.floor((100 * numerator) / VARISPEED_DENOMINATOR)]);
    expect(left?.[500 + length - 1]).not.toBe(0);
    expect(left?.[500 + length]).toBe(0);
  });

  it('fades a stolen voice out over 5 ms from the steal, as its replacement starts in another lane', () => {
    const pool = [poolMember(1, 5_000)];
    const rules = { ...DEFAULT_EMITTER_RULES, voices: { limit: 1, stealing: 'oldest' as const } };
    const spec = oneEmitter(pool, rules, { kind: 'by-hand' });
    const hand = [
      { kind: 'trigger', emitter: emitterId(1), frame: 0 },
      { kind: 'trigger', emitter: emitterId(1), frame: 1_000 },
    ] as const;
    const { heard, plan } = built({ ...spec, hand }, plansOf(pool));
    const [left] = heard;
    // From 1,000 the first voice falls linearly over 240 frames while the second starts.
    for (const k of [0, 1, 120, 239]) {
      const fading = Math.fround((RAMP[1_000 + k] ?? 0) * (1 - k / 239));
      expect(left?.[1_000 + k]).toBeCloseTo(fading + (RAMP[k] ?? 0), 6);
    }
    expect(left?.[1_240]).toBe(RAMP[240]);
    // Two lanes of the one emitter's one bus, the fade and its replacement apart.
    expect([...plan.lanes.keys()]).toEqual([
      `${emitterId(1)}:0:Master`,
      `${emitterId(1)}:1:Master`,
    ]);
  });

  it('cycles a loop from its end back to its start for as long as the plan runs', () => {
    const pool = [poolMember(1, 2_000, { loop: { start: 500, end: 1_500 } })];
    const spec = oneEmitter(pool, DEFAULT_EMITTER_RULES, { kind: 'by-hand' }, 6_000);
    const { heard } = built(
      { ...spec, hand: [{ kind: 'trigger', emitter: emitterId(1), frame: 100 }] },
      plansOf(pool),
    );
    const [left] = heard;
    expect(left?.[100 + 1_499]).toBe(RAMP[1_499]);
    expect(left?.[100 + 1_500]).toBe(RAMP[500]);
    expect(left?.[100 + 2_500]).toBe(RAMP[500]);
    expect(left?.[5_999]).toBe(RAMP[500 + ((5_999 - 100 - 1_500) % 1_000)]);
  });

  it('plays each bus at its level and folds the stereo mix to the project’s layout', () => {
    const pool = [poolMember(1, 1_000, { bus: SFX_BUS })];
    const spec = oneEmitter(pool, DEFAULT_EMITTER_RULES, { kind: 'by-hand' });
    const levelled: VectorSpec = {
      ...spec,
      scenario: { ...spec.scenario, busLevels: [{ bus: SFX_BUS, decibels: -6 }] },
      hand: [{ kind: 'trigger', emitter: emitterId(1), frame: 0 }],
    };
    const { heard, plan } = built(levelled, plansOf(pool), StandardLayouts.mono);
    expect(heard).toHaveLength(1);
    // A stereo pair folds to mono as their average: the level alone remains.
    expect(heard[0]?.[10]).toBeCloseTo((RAMP[10] ?? 0) * decibelsToGain(-6), 6);
    const sfx = plan.controls.buses.get(SFX_BUS);
    expect(sfx?.stream).toBe(1);
    expect(plan.controls.emitters.get(emitterId(1))?.map((one) => one.bus)).toEqual([SFX_BUS]);
  });

  it('gives an emitter one panned stream for each bus its members play on', () => {
    const pool = [poolMember(1, 1_000, { bus: SFX_BUS }), poolMember(2, 1_000)];
    const { plan } = built(
      oneEmitter(pool, DEFAULT_EMITTER_RULES, { kind: 'by-hand' }),
      plansOf(pool),
    );
    const panners = plan.controls.emitters.get(emitterId(1)) ?? [];
    expect(panners.map((one) => one.bus)).toEqual(['Master', SFX_BUS]);
    expect(new Set(panners.map((one) => one.panner)).size).toBe(2);
    expect([...plan.controls.buses.keys()]).toEqual(['Master', SFX_BUS]);
  });

  it('moves a moving emitter’s panner along its path as automation of x, y and z', () => {
    const pool = [poolMember(1, 1_000)];
    const emitter = repeatEmitter(
      1,
      { kind: 'by-hand' },
      {
        motion: {
          kind: 'waypoints',
          points: [
            { at: { x: 0, y: 0, z: -1 }, milliseconds: 0 },
            { at: { x: 4, y: 0, z: -1 }, milliseconds: 1_000 },
          ],
          repeat: 'once',
        },
      },
    );
    const spec: VectorSpec = {
      ...oneEmitter(pool, DEFAULT_EMITTER_RULES, { kind: 'by-hand' }),
      scenario: vectorScenario([emitter], 1),
    };
    const { plan } = built(spec, plansOf(pool));
    const stream = plan.controls.emitters.get(emitterId(1))?.[0]?.stream ?? -1;
    const processing = plan.plan.streams[stream]?.processing;
    const automation = processing?.kind === 'chain' ? processing.automation : undefined;
    expect(automation?.map((lane) => lane.points)).toEqual([
      [
        { frame: 0, value: 0 },
        { frame: 48_000, value: 4 },
      ],
      [
        { frame: 0, value: 0 },
        { frame: 48_000, value: 0 },
      ],
      [
        { frame: 0, value: -1 },
        { frame: 48_000, value: -1 },
      ],
    ]);
  });

  it('is refused where a member has no plan, the catalogue no panner, or the panner refuses a rule', () => {
    const pool = [poolMember(1, 1_000)];
    const spec = oneEmitter(pool, DEFAULT_EMITTER_RULES, { kind: 'by-hand' });
    const simulation = expectSuccess(simulatePreview(vectorInput(spec)));
    const plan = (members: ReadonlyMap<string, EditPlan>, catalogue = PREVIEW_TEST_CATALOGUE) =>
      previewPlan(
        simulation,
        spec.scenario,
        members,
        catalogue,
        createDeterministicIdGenerator(1),
        StandardLayouts.stereo,
      );
    const code = (result: ReturnType<typeof plan>) => (result.ok ? 'ok' : result.failures[0].code);
    expect(code(plan(new Map()))).toBe('preview.member-unplayable');
    expect(code(plan(plansOf([poolMember(1, 999)])))).toBe('preview.member-unplayable');
    expect(code(plan(plansOf(pool), new Map()))).toBe('preview.processor-missing');
    const tiny = {
      ...DEFAULT_EMITTER_RULES,
      attenuation: { kind: 'inverse', unitSize: 0.001, maxDistance: 10, ceilingDecibels: 0 },
    } as const;
    const tinySpec = oneEmitter(pool, tiny, { kind: 'by-hand' });
    const refused = expectSuccess(simulatePreview(vectorInput(tinySpec)));
    const result = previewPlan(
      refused,
      tinySpec.scenario,
      plansOf(pool),
      PREVIEW_TEST_CATALOGUE,
      createDeterministicIdGenerator(1),
      StandardLayouts.stereo,
    );
    expect(code(result)).toBe('parameter.out-of-range');
  });
});
