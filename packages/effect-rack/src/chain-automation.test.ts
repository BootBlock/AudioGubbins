/**
 * A chain's parameters moved along its stream by a plan's automation
 * (ADR-0104): linear between points, given to each processor every 32 frames of
 * the run as the frame it hears, so an automated chain rendered offline is the
 * chain run with the same running changes at the same frames, however its run
 * is cut, wherever its processor sits behind others, and in every measuring
 * pass as in the run.
 */

import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_QUALITY,
  StandardLayouts,
  createDeterministicIdGenerator,
  instantiateProcessor,
  type ChainSlot,
  type EffectChain,
  type ParameterValue,
  type ProcessorInstance,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { REFERENCE_DSP, decibelsToGain, type ChainRun } from '@audiogubbins/audio-engine';
import { fingerprint } from '@audiogubbins/audio-engine/testing';
import { PROCESSOR_TYPES_BY_KEY, type ProcessorType } from '@audiogubbins/processors';
import { TEST_RATE, delayingProcessor, processorValues } from '@audiogubbins/processors/testing';
import { noise } from '@audiogubbins/test-fixtures';

import type { AutomationPoint, ParameterAutomation } from './chain-automation.js';
import { chainProcessing } from './chain-run.js';

const ids = createDeterministicIdGenerator(104);
const DELAY = delayingProcessor(64);
const TYPES: ReadonlyMap<string, ProcessorType> = new Map([
  ...PROCESSOR_TYPES_BY_KEY,
  [DELAY.descriptor.typeKey, DELAY],
]);

function typeOf(key: string): ProcessorType {
  const type = TYPES.get(key);
  if (type === undefined) throw new Error(`The catalogue has a ${key}.`);
  return type;
}

function slotOf(
  key: string,
  values: Readonly<Record<string, ParameterValue>> = {},
): ProcessorInstance {
  const type = typeOf(key);
  return {
    ...instantiateProcessor(ids.next(), type.descriptor),
    values: processorValues(type, values),
  };
}

/** The lane moving `key` of `processor` through `points`. */
function lane(
  processor: ProcessorInstance,
  key: string,
  points: readonly AutomationPoint[],
): ParameterAutomation {
  const parameter = typeOf(processor.typeKey).descriptor.parameters.find((one) => one.key === key);
  if (parameter === undefined) throw new Error(`${processor.typeKey} has a ${key}.`);
  return { processor: processor.id, parameter: parameter.id, points };
}

const LENGTH = 24_000;
const MONO = [noise(5).channels[0]?.slice(0, LENGTH) ?? new Float32Array(LENGTH)];

interface Run {
  readonly slots: readonly ChainSlot[];
  readonly automation?: readonly ParameterAutomation[];
  readonly start?: number;
}

async function prepared({ slots, automation, start = 0 }: Run) {
  const chain: EffectChain = { id: ids.next(), slots };
  return await chainProcessing(TYPES).prepare(
    {
      chain,
      input: StandardLayouts.mono,
      sampleRate: TEST_RATE,
      length: LENGTH,
      quality: MAXIMUM_QUALITY.settings,
      blockFrames: 512,
      dsp: REFERENCE_DSP,
      start,
      ...(automation === undefined ? {} : { automation }),
    },
    async (at, frames, into) => {
      into[0]?.set(MONO[0]?.subarray(at, at + frames) ?? []);
      await Promise.resolve();
    },
  );
}

/**
 * `run` over the input from its start, in calls whose sizes cycle through
 * `calls`, `before` called with the frame of the run each call starts at.
 */
function rendered(
  run: ChainRun,
  calls: readonly number[],
  from = 0,
  before: (frame: number) => void = () => undefined,
): Float32Array[] {
  const source = MONO[0]?.subarray(from) ?? new Float32Array(0);
  const out = run.layout.roles.map(() => new Float32Array(source.length));
  for (let at = 0, turn = 0; at < source.length; turn += 1) {
    const frames = Math.min(calls[turn % calls.length] ?? 128, source.length - at);
    before(at);
    run.process(
      [source.subarray(at, at + frames)],
      out.map((channel) => channel.subarray(at, at + frames)),
      frames,
    );
    at += frames;
  }
  run.release();
  return out;
}

/** Frames from one value a lane gives its processor to the next. */
const INTERVAL = 32;

/**
 * The value of `points` at `frame` as the plan states it, written apart from
 * the runner: held before the first point and after the last, and on the
 * straight line between the two around it.
 */
function automatedValue(points: readonly AutomationPoint[], frame: number): number {
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) throw new Error('A lane has a point.');
  if (frame <= first.frame) return first.value;
  if (frame >= last.frame) return last.value;
  const next = points.findIndex((point) => point.frame > frame);
  const [from, to] = [points[next - 1] ?? first, points[next] ?? last];
  return from.value + ((to.value - from.value) * (frame - from.frame)) / (to.frame - from.frame);
}

const prints = (channels: readonly Float32Array[]) => channels.map((one) => fingerprint(one));

/** An emitter passing from left to right and away, through three waypoints. */
const SWEEP: readonly AutomationPoint[] = [
  { frame: 0, value: -30 },
  { frame: 9_000, value: 4 },
  { frame: 20_000, value: 25 },
];

describe('a chain run with automation', () => {
  /**
   * `slot` run with its `key` moved by `points` as automation, and the same
   * slot, made where the lane starts it, moved by running changes every 32
   * frames to the lane's value there, each rendered from the stream's start.
   */
  async function automatedAndByHand(
    slot: ProcessorInstance,
    key: string,
    points: readonly AutomationPoint[],
  ): Promise<{ readonly offline: Float32Array[]; readonly byHand: Float32Array[] }> {
    const { parameter } = lane(slot, key, points);
    const automated = expectSuccess(
      await prepared({ slots: [slot], automation: [lane(slot, key, points)] }),
    );
    let given = automatedValue(points, 0);
    const startedThere = { ...slot, values: new Map(slot.values).set(parameter, given) };
    const moved = expectSuccess(await prepared({ slots: [startedThere] }));
    const byHand = rendered(moved, [INTERVAL], 0, (frame) => {
      const value = automatedValue(points, frame);
      if (value !== given) expectSuccess(moved.setParameter(slot.id, parameter, value));
      given = value;
    });
    return { offline: rendered(automated, [LENGTH]), byHand };
  }

  it('renders a moving emitter the same as running changes at the same frames', async () => {
    const panner = slotOf('spatial-panner', { z: -6, 'unit-size': 2 });
    const { offline, byHand } = await automatedAndByHand(panner, 'x', SWEEP);
    expect(prints(offline)).toEqual(prints(byHand));
    // And it moved: the emitter starts on the left and ends on the right.
    const [left, right] = offline;
    expect(Math.abs(left?.[100] ?? 0)).toBeGreaterThan(Math.abs(right?.[100] ?? 0));
    expect(Math.abs(left?.[23_000] ?? 0)).toBeLessThan(Math.abs(right?.[23_000] ?? 0));
  });

  it('follows a lane of many points, each between the two around it', async () => {
    const zigzag = Array.from({ length: 400 }, (_, index) => ({
      frame: index * 53 + (index % 3),
      value: index % 2 === 0 ? -18 : 3,
    }));
    const { offline, byHand } = await automatedAndByHand(slotOf('gain'), 'gain', zigzag);
    expect(prints(offline)).toEqual(prints(byHand));
  });

  it('gives the same bits however its run is cut into calls', async () => {
    const panner = slotOf('spatial-panner', { z: -6 });
    const automation = [lane(panner, 'x', SWEEP)];
    const whole = rendered(expectSuccess(await prepared({ slots: [panner], automation })), [
      LENGTH,
    ]);
    const cut = rendered(
      expectSuccess(await prepared({ slots: [panner], automation })),
      [1, 31, 100, 7, 4_096],
    );
    expect(prints(cut)).toEqual(prints(whole));
  });

  it('starts each processor at its lane’s value, with no ramp from its slot’s own', async () => {
    const gain = slotOf('gain', { gain: -40 });
    const held = rendered(
      expectSuccess(
        await prepared({
          slots: [gain],
          automation: [lane(gain, 'gain', [{ frame: 0, value: 6 }])],
        }),
      ),
      [512],
    );
    const fixed = rendered(
      expectSuccess(await prepared({ slots: [slotOf('gain', { gain: 6 })] })),
      [512],
    );
    expect(prints(held)).toEqual(prints(fixed));
  });

  it('reads a lane at the frame its processor hears, behind a late processor', async () => {
    const points = [
      { frame: 2_000, value: -30 },
      { frame: 2_640, value: 12 },
      { frame: 9_000, value: -6 },
    ];
    const first = slotOf('gain');
    const before = rendered(
      expectSuccess(
        await prepared({
          slots: [first, slotOf(DELAY.descriptor.typeKey)],
          automation: [lane(first, 'gain', points)],
        }),
      ),
      [512],
    );
    const second = slotOf('gain');
    const after = rendered(
      expectSuccess(
        await prepared({
          slots: [slotOf(DELAY.descriptor.typeKey), second],
          automation: [lane(second, 'gain', points)],
        }),
      ),
      [512],
    );
    // A pure delay before or after a gain moved with the stream is one sound.
    expect(prints(after)).toEqual(prints(before));
  });

  it('starts a run part way at the lane’s value there', async () => {
    const gain = slotOf('gain', { gain: -40 });
    const points = [
      { frame: 0, value: -12 },
      { frame: 4_000, value: 6 },
    ];
    const part = rendered(
      expectSuccess(
        await prepared({ slots: [gain], automation: [lane(gain, 'gain', points)], start: 6_000 }),
      ),
      [512],
      6_000,
    );
    const source = MONO[0]?.[6_000] ?? 0;
    expect(part[0]?.[0]).toBe(Math.fround(source * decibelsToGain(6)));
  });

  it('runs its automation in a measuring pass as in the run', async () => {
    const gain = slotOf('gain', { gain: -24 });
    const normalise = slotOf('peak-normalisation', { target: -1 });
    const rise = [
      { frame: 0, value: -24 },
      { frame: 12_000, value: -24 },
      { frame: 12_001, value: 12 },
    ];
    const [out] = rendered(
      expectSuccess(
        await prepared({ slots: [gain, normalise], automation: [lane(gain, 'gain', rise)] }),
      ),
      [512],
    );
    let peak = 0;
    for (const sample of out ?? []) peak = Math.max(peak, Math.abs(sample));
    // Measured without the rise the pass would find a peak 36 dB lower, and
    // its gain would carry the loud half far over full scale.
    expect(peak).toBeCloseTo(decibelsToGain(-1), 4);
  });
});

describe('a chain run refusing automation it cannot follow', () => {
  it('refuses a lane on a processor that is bypassed or not in the chain', async () => {
    const gain = slotOf('gain');
    const bypassed = { ...gain, enabled: false };
    const away = lane(slotOf('gain'), 'gain', [{ frame: 0, value: 0 }]);
    for (const run of [
      { slots: [bypassed], automation: [lane(gain, 'gain', [{ frame: 0, value: 0 }])] },
      { slots: [gain], automation: [away] },
    ]) {
      expect(expectFailureCode(await prepared(run))).toBe(
        'effect-rack.automation-processor-not-running',
      );
    }
  });

  it('refuses a parameter that is not numeric, and a processor heard from a render', async () => {
    const filter = slotOf('filter');
    const mode = typeOf('filter').descriptor.parameters.find((one) => one.key === 'mode');
    if (mode === undefined) throw new Error('A filter has a mode.');
    expect(
      expectFailureCode(
        await prepared({
          slots: [filter],
          automation: [
            { processor: filter.id, parameter: mode.id, points: [{ frame: 0, value: 1 }] },
          ],
        }),
      ),
    ).toBe('effect-rack.automation-parameter-not-numeric');
    const loudness = slotOf('loudness-normalisation');
    expect(
      expectFailureCode(
        await prepared({
          slots: [loudness],
          automation: [lane(loudness, 'target', [{ frame: 0, value: -20 }])],
        }),
      ),
    ).toBe('effect-rack.automation-not-live');
  });

  it.each([
    ['no points', []],
    [
      'points out of order',
      [
        { frame: 10, value: 0 },
        { frame: 10, value: 1 },
      ],
    ],
    ['a point at a negative frame', [{ frame: -1, value: 0 }]],
    ['a value out of range', [{ frame: 0, value: 60 }]],
  ])('refuses a lane with %s', async (_case, points) => {
    const gain = slotOf('gain');
    expect(
      expectFailureCode(
        await prepared({ slots: [gain], automation: [lane(gain, 'gain', points)] }),
      ),
    ).toBe('effect-rack.automation-points-invalid');
  });

  it('refuses two lanes moving one parameter', async () => {
    const gain = slotOf('gain');
    const one = lane(gain, 'gain', [{ frame: 0, value: 0 }]);
    expect(expectFailureCode(await prepared({ slots: [gain], automation: [one, one] }))).toBe(
      'effect-rack.automation-lane-twice',
    );
  });

  it('refuses a running change to an automated parameter, and takes one to another', async () => {
    const panner = slotOf('spatial-panner');
    const run = expectSuccess(
      await prepared({ slots: [panner], automation: [lane(panner, 'x', SWEEP)] }),
    );
    const parameter = (key: string) => lane(panner, key, [{ frame: 0, value: 0 }]).parameter;
    expect(expectFailureCode(run.setParameter(panner.id, parameter('x'), 3))).toBe(
      'effect-rack.parameter-automated',
    );
    expectSuccess(run.setParameter(panner.id, parameter('z'), -3));
    run.release();
  });
});
