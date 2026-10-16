import { describe, expect, it } from 'vitest';

import {
  StandardLayouts,
  derivedSampleCount,
  sampleRate,
  unsafeBrandId,
  type EditPlan,
  type EffectChain,
  type PlanSegment,
  type PlanSource,
  type PlanStream,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { planDivergence, type ReadingState } from './plan-divergence.js';

const MONO = StandardLayouts.mono;
const RATE = expectSuccess(sampleRate(48_000));
const SLOW = expectSuccess(sampleRate(24_000));
const ASSET = unsafeBrandId<'AssetId'>('0000d1fe-0001');
const LEVEL = unsafeBrandId<'ParameterId'>('0000d1fe-0002');
const NEVER = Number.POSITIVE_INFINITY;

function segment(source: PlanSource, start: number, length: number, reversed = false): PlanSegment {
  return {
    source,
    start: derivedSampleCount(start),
    length: derivedSampleCount(length),
    reversed,
    stages: [],
  };
}

const FILE: PlanSource = { kind: 'media', asset: ASSET };
const SILENCE: PlanSource = { kind: 'silence', channels: 1 };

function stream(segments: readonly PlanSegment[], extra: Partial<PlanStream> = {}): PlanStream {
  return { sampleRate: RATE, layout: MONO, segments, ...extra };
}

function chain(level: number): EffectChain {
  return {
    id: unsafeBrandId<'EffectChainId'>('0000d1fe-0003'),
    slots: [
      {
        kind: 'processor',
        id: unsafeBrandId<'ProcessorId'>('0000d1fe-0004'),
        typeKey: 'gain',
        enabled: true,
        soloed: false,
        mix: 1,
        version: { implementation: 1, parameters: 1 },
        values: new Map([[LEVEL, level]]),
      },
    ],
  };
}

/** A plan of `first` reading `rest`. */
function plan(first: PlanStream, ...rest: PlanStream[]): EditPlan {
  return { streams: [first, ...rest] };
}

/** A reading that holds no run and no conversion, and whose file is unchanged. */
const STATELESS: ReadingState = {
  chain: () => undefined,
  run: () => undefined,
  conversion: () => undefined,
  varispeed: () => undefined,
  sameFile: () => true,
};

describe('where a continuing plan may first differ', () => {
  it('finds no difference anywhere in a plan read again as it was', () => {
    const before = plan(
      stream([segment({ kind: 'stream', stream: 1 }, 0, 100)]),
      stream([segment(FILE, 0, 100)]),
    );

    const divergence = planDivergence(before, before, STATELESS);

    expect([0, 1].map((place) => divergence.sameDefinition(place))).toEqual([true, true]);
    expect([0, 1].map((place) => divergence.input(place))).toEqual([NEVER, NEVER]);
    expect(divergence.output(1)).toBe(NEVER);
  });

  it('finds a lengthened segment different where the shorter ends, and a stream reading it where it reads that', () => {
    const before = plan(
      stream([segment({ kind: 'stream', stream: 1 }, 10, 90)]),
      stream([segment(SILENCE, 0, 60), segment(FILE, 0, 40)]),
    );
    const after = plan(
      stream([segment({ kind: 'stream', stream: 1 }, 10, 90)]),
      stream([segment(SILENCE, 0, 60), segment(FILE, 0, 50)]),
    );

    const divergence = planDivergence(before, after, STATELESS);

    expect(divergence.input(1)).toBe(100);
    // Stream 0 reads stream 1 from its frame 10, so frame 100 of it is frame 90 of stream 0: past its end.
    expect(divergence.input(0)).toBe(NEVER);
  });

  it('finds a reversed segment different from its first frame where its length changes or its end does', () => {
    const before = plan(stream([segment(SILENCE, 0, 20), segment(FILE, 0, 40, true)]));
    const lengthened = plan(stream([segment(SILENCE, 0, 20), segment(FILE, 0, 50, true)]));
    const fileChanged = { ...STATELESS, sameFile: () => false };

    expect(planDivergence(before, lengthened, STATELESS).input(0)).toBe(20);
    expect(planDivergence(before, before, fileChanged).input(0)).toBe(20);
  });

  it('finds a segment through other stages, or from another frame, different from where it begins', () => {
    const faded = (gain: number): PlanSegment => ({
      ...segment(FILE, 0, 40),
      stages: [{ kind: 'gain', from: 0, to: 40, gain: { kind: 'constant', gain } }],
    });
    const before = plan(stream([segment(SILENCE, 0, 20), faded(0.5)]));

    expect(
      planDivergence(before, plan(stream([segment(SILENCE, 0, 20), faded(0.25)])), STATELESS).input(
        0,
      ),
    ).toBe(20);
    expect(
      planDivergence(
        before,
        plan(stream([segment(SILENCE, 0, 20), { ...faded(0.5), start: derivedSampleCount(1) }])),
        STATELESS,
      ).input(0),
    ).toBe(20);
  });

  it('finds a stream whose chain changed different throughout, unless the change is what its run already plays', () => {
    const through = (level: number) =>
      plan(
        stream([segment({ kind: 'stream', stream: 1 }, 0, 100)]),
        stream([segment(FILE, 0, 100)], {
          processing: { kind: 'chain', chain: chain(level), input: MONO },
        }),
      );

    const changed = planDivergence(through(1), through(2), STATELESS);
    const runningAlready = planDivergence(through(1), through(2), {
      ...STATELESS,
      chain: (place) => (place === 1 ? chain(2) : undefined),
    });

    expect(changed.sameDefinition(1)).toBe(false);
    expect([changed.input(1), changed.output(1), changed.input(0)]).toEqual([0, 0, 0]);
    expect(runningAlready.sameDefinition(1)).toBe(true);
    expect(runningAlready.input(0)).toBe(NEVER);
  });

  it('finds a chain’s output different its latency before its input, and throughout where a pass measured past the change', () => {
    const through = (length: number) =>
      plan(
        stream([segment({ kind: 'stream', stream: 1 }, 0, 100)]),
        stream([segment(FILE, 0, 100), segment(SILENCE, 0, length)], {
          processing: { kind: 'chain', chain: chain(1), input: MONO },
        }),
      );
    const running = (measuredTo: number): ReadingState => ({
      ...STATELESS,
      run: () => ({ consumedTo: 50, latency: 16, measuredTo }),
    });

    expect(planDivergence(through(20), through(30), running(0)).output(1)).toBe(104);
    expect(planDivergence(through(20), through(30), running(NEVER)).output(1)).toBe(0);
    // With no run to say its latency, the whole of it.
    expect(planDivergence(through(20), through(30), STATELESS).output(1)).toBe(0);
  });

  it('finds a mix different where the first of the streams it sums is', () => {
    const lanes = (second: number) =>
      plan(
        stream([segment({ kind: 'mix', streams: [1, 2] }, 0, 100)]),
        stream([segment(SILENCE, 0, 70), segment(FILE, 0, 30)]),
        stream([segment(SILENCE, 0, second), segment(FILE, 0, 100 - second)]),
      );

    expect(planDivergence(lanes(80), lanes(60), STATELESS).input(0)).toBe(60);
  });

  it('finds a converted stream different from the first frame whose filter reaches the change', () => {
    const converted = (tail: PlanSource) =>
      plan(
        stream([segment({ kind: 'stream', stream: 1 }, 0, 200)]),
        stream([segment(FILE, 0, 100), segment(tail, 0, 20)], { sampleRate: SLOW }),
      );
    const resampling: ReadingState = { ...STATELESS, conversion: () => 8 };

    // At 24 kHz frame 100 changes; with 8 frames of lookahead the output from
    // (100 − 8 − 2) × 2 = 180 at 48 kHz may hear it.
    expect(planDivergence(converted(SILENCE), converted(FILE), resampling).input(0)).toBe(180);
    // With no conversion made to say its filter's reach, from its first frame.
    expect(planDivergence(converted(SILENCE), converted(FILE), STATELESS).input(0)).toBe(0);
  });

  it('finds a stream the new plan does not have, or has at another rate, different throughout', () => {
    const before = plan(
      stream([segment({ kind: 'stream', stream: 1 }, 0, 10)]),
      stream([segment(FILE, 0, 10)]),
    );
    const slower = plan(
      stream([segment({ kind: 'stream', stream: 1 }, 0, 10)]),
      stream([segment(FILE, 0, 10)], { sampleRate: SLOW }),
    );

    expect(
      planDivergence(before, plan(stream([segment(FILE, 0, 10)])), STATELESS).sameDefinition(1),
    ).toBe(false);
    expect(planDivergence(before, slower, STATELESS).input(0)).toBe(0);
  });

  it('compares a stream that has forgotten its past only from where it remembers', () => {
    // A lane that played a file before frame 40 and silence since, and its
    // chain's level moved by points before and after 40, as a preview leaves
    // them once it has dropped what was heard.
    const level = (points: readonly (readonly [number, number])[]) => [
      {
        processor: unsafeBrandId<'ProcessorId'>('0000d1fe-0004'),
        parameter: LEVEL,
        points: points.map(([frame, value]) => ({ frame, value })),
      },
    ];
    const lane = (
      segments: readonly PlanSegment[],
      points: readonly (readonly [number, number])[],
      forgottenBefore?: number,
    ) =>
      plan(
        stream([segment({ kind: 'stream', stream: 1 }, 0, 100)]),
        stream(segments, {
          processing: { kind: 'chain', chain: chain(1), input: MONO, automation: level(points) },
          ...(forgottenBefore === undefined
            ? {}
            : { forgottenBefore: derivedSampleCount(forgottenBefore) }),
        }),
      );
    const played = lane(
      [segment(FILE, 0, 30), segment(SILENCE, 0, 10), segment(SILENCE, 0, 60)],
      [
        [0, 1],
        [20, 2],
        [50, 3],
        [90, 4],
      ],
    );
    const remembered = (forgottenBefore?: number) =>
      lane(
        [segment(SILENCE, 0, 40), segment(SILENCE, 0, 60)],
        [
          [20, 2],
          [50, 3],
          [90, 4],
        ],
        forgottenBefore,
      );

    expect(planDivergence(played, remembered(40), STATELESS).input(1)).toBe(NEVER);
    // Unstated, the past it dropped is a difference from the first frame.
    expect(planDivergence(played, remembered(), STATELESS).input(1)).toBe(0);
    // And a point moved past where it remembers from is a difference there.
    const moved = lane(
      [segment(SILENCE, 0, 40), segment(SILENCE, 0, 60)],
      [
        [20, 2],
        [50, 3],
        [80, 4],
      ],
      40,
    );
    expect(planDivergence(played, moved, STATELESS).input(1)).toBe(51);
  });
});
