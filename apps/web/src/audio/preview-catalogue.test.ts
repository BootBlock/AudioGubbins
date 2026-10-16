/**
 * The game preview's plan against the processors' real catalogue (ADR-0104).
 *
 * The game-audio package plans with a restatement of the spatial panner's and
 * the gain's descriptors, since it may not reach the processors; the
 * application plans with the processors' own. So a plan the package's tests
 * prove could still name a value the real panner refuses, or a parameter it
 * has not got. Here every rule and space the preview can be given is planned
 * with the real catalogue and each value checked against the real descriptor;
 * and the restatement is held to the real descriptors, parameter by
 * parameter, so it cannot drift from them.
 */

import { describe, expect, it } from 'vitest';

import {
  StandardLayouts,
  createDeterministicIdGenerator,
  derivedSampleCount,
  sampleRate,
  unsafeBrandId,
  validateParameterValue,
  type EditPlan,
  type ParameterDescriptor,
  type ProcessorDescriptor,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  DEFAULT_EMITTER_RULES,
  DEFAULT_VOICE_VARIATION,
  memberKey,
  previewPlan,
  simulatePreview,
  type Attenuation,
  type EmitterRules,
  type GamePreviewScenario,
  type GroupMember,
  type PoolMember,
} from '@audiogubbins/game-audio';
import { PREVIEW_TEST_CATALOGUE } from '@audiogubbins/game-audio/testing';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';

const RATE = expectSuccess(sampleRate(48_000));
const MEMBER: GroupMember = { kind: 'region', region: unsafeBrandId<'RegionId'>('0000a000-0001') };
const FAR = 250_000;

const SOUND: EditPlan = {
  streams: [
    {
      sampleRate: RATE,
      layout: StandardLayouts.mono,
      segments: [
        {
          source: { kind: 'media', asset: unsafeBrandId<'AssetId'>('0000beef-0001') },
          start: derivedSampleCount(0),
          length: derivedSampleCount(4_800),
          reversed: false,
          stages: [],
        },
      ],
    },
  ],
};

const POOL: readonly PoolMember[] = [
  {
    member: MEMBER,
    variation: DEFAULT_VOICE_VARIATION,
    bus: undefined,
    sampleRate: RATE,
    length: 4_800,
  },
];

/** Every attenuation the rules may hold, at the edges of their ranges. */
const ATTENUATIONS: readonly Attenuation[] = [
  { kind: 'none' },
  { kind: 'inverse', unitSize: 0.01, maxDistance: 0, ceilingDecibels: -80 },
  { kind: 'inverse-square', unitSize: 1_000_000, maxDistance: 1_000_000, ceilingDecibels: 24 },
  { kind: 'logarithmic', unitSize: 1, maxDistance: 500, ceilingDecibels: 3 },
  { kind: 'exponent', maxDistance: 0, exponent: 0.01 },
  { kind: 'exponent', maxDistance: 1_000_000, exponent: 16 },
];

const FILTERS: readonly EmitterRules['filter'][] = [
  undefined,
  { cutoffHertz: 20, decibels: -80 },
  { cutoffHertz: 20_000, decibels: 0 },
];

/** A scenario in `space` of emitters at the far corners of the space, the listener turned and moved. */
function scenarioIn(space: GamePreviewScenario['space']): GamePreviewScenario {
  const corners = [
    { x: FAR, y: -FAR, z: space === '3d' ? FAR : 0 },
    { x: -FAR, y: FAR, z: space === '3d' ? -FAR : 0 },
  ];
  return {
    id: unsafeBrandId<'GamePreviewScenarioId'>('5ce00000-0001'),
    name: 'Catalogue',
    space,
    panWidth: space === '2d' ? 1 : 1_000_000,
    panningStrength: 1,
    listener: { at: { x: -FAR, y: FAR, z: space === '3d' ? FAR : 0 }, facingTurns: 0.375 },
    emitters: [
      {
        id: unsafeBrandId<'PreviewEmitterId'>('e0000000-0001'),
        name: 'Still',
        subject: { kind: 'member', member: MEMBER },
        trigger: { kind: 'by-hand' },
        motion: { kind: 'still', at: corners[0] ?? { x: 0, y: 0, z: 0 } },
      },
      {
        id: unsafeBrandId<'PreviewEmitterId'>('e0000000-0002'),
        name: 'Moving',
        subject: { kind: 'member', member: MEMBER },
        trigger: { kind: 'by-hand' },
        motion: {
          kind: 'waypoints',
          points: corners.map((at, index) => ({ at, milliseconds: index * 1_000 })),
          repeat: 'back-and-forth',
        },
      },
    ],
    seed: 1,
    busLevels: [],
  };
}

/** Each panner's value the plan of `scenario` played by `rules` gives it, with the real descriptor of its parameter. */
function pannerValues(
  scenario: GamePreviewScenario,
  rules: EmitterRules,
): readonly { readonly parameter: ParameterDescriptor; readonly value: unknown }[] {
  const simulated = expectSuccess(
    simulatePreview({
      scenario,
      emitterRules: () => rules,
      poolOf: () => POOL,
      hand: [],
      sampleRate: RATE,
      voiceBudget: 64,
      horizonFrame: RATE,
    }),
  );
  const planned = expectSuccess(
    previewPlan(
      simulated,
      scenario,
      new Map([[memberKey(MEMBER), SOUND]]),
      PROCESSOR_CATALOGUE,
      createDeterministicIdGenerator(1),
      StandardLayouts.stereo,
    ),
  );
  const real = PROCESSOR_CATALOGUE.get('spatial-panner');
  if (real === undefined) throw new Error('The catalogue has a spatial panner.');
  const found: { readonly parameter: ParameterDescriptor; readonly value: unknown }[] = [];
  for (const panners of planned.controls.emitters.values()) {
    for (const { stream } of panners) {
      const processing = planned.plan.streams[stream]?.processing;
      if (processing?.kind !== 'chain') throw new Error('A panner stream runs a chain.');
      for (const slot of processing.chain.slots) {
        if (slot.kind !== 'processor') continue;
        for (const [id, value] of slot.values) {
          const parameter = real.parameters.find((one) => one.id === id);
          if (parameter === undefined) throw new Error(`The real panner has no parameter ${id}.`);
          found.push({ parameter, value });
        }
      }
      for (const lane of processing.automation ?? []) {
        const parameter = real.parameters.find((one) => one.id === lane.parameter);
        if (parameter === undefined)
          throw new Error(`The real panner has no parameter ${lane.parameter}.`);
        for (const point of lane.points) found.push({ parameter, value: point.value });
      }
    }
  }
  return found;
}

const CASES = (['2d', '3d'] as const).flatMap((space) =>
  ATTENUATIONS.flatMap((attenuation) =>
    FILTERS.map((filter) => ({
      space,
      rules: { ...DEFAULT_EMITTER_RULES, attenuation, ...(filter === undefined ? {} : { filter }) },
    })),
  ),
);

describe("the preview plan's panners against the real catalogue", () => {
  it.each(CASES)('takes every value of $space, $rules.attenuation.kind', ({ space, rules }) => {
    const values = pannerValues(scenarioIn(space), rules);

    expect(values.length).toBeGreaterThan(0);
    for (const { parameter, value } of values) {
      if (typeof value !== 'number' && typeof value !== 'string' && typeof value !== 'boolean') {
        throw new Error(`${parameter.key} holds no parameter value.`);
      }
      expect(
        validateParameterValue(parameter, value).ok,
        `${parameter.key} = ${String(value)}`,
      ).toBe(true);
    }
  });
});

/** What a descriptor's parameter is, apart from its identifier and label: its kind and range or options. */
function shapeOf(parameter: ParameterDescriptor): unknown {
  switch (parameter.kind) {
    case 'numeric':
      return { kind: parameter.kind, minimum: parameter.minimum, maximum: parameter.maximum };
    case 'choice':
      return { kind: parameter.kind, options: parameter.options.map((one) => one.key) };
    case 'toggle':
      return { kind: parameter.kind };
  }
}

function shapesOf(descriptor: ProcessorDescriptor | undefined): ReadonlyMap<string, unknown> {
  return new Map(descriptor?.parameters.map((one) => [one.key, shapeOf(one)]) ?? []);
}

describe("the game-audio tests' restatement of the catalogue", () => {
  it.each(['spatial-panner', 'gain'])('states %s as the processors do', (typeKey) => {
    const stated = shapesOf(PREVIEW_TEST_CATALOGUE.get(typeKey));
    const real = shapesOf(PROCESSOR_CATALOGUE.get(typeKey));

    expect(stated.size).toBeGreaterThan(0);
    // Every parameter the restatement names is the real one's shape.
    for (const [key, shape] of stated) expect(real.get(key), key).toEqual(shape);
    // And the panner, which the plan sets wholly, names every real parameter.
    if (typeKey === 'spatial-panner')
      expect([...stated.keys()].toSorted()).toEqual([...real.keys()].toSorted());
  });
});
