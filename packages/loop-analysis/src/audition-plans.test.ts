import { describe, expect, it } from 'vitest';

import {
  PcmDescriptionKind,
  REFERENCE_DSP,
  allocateBlock,
  describedSource,
} from '@audiogubbins/audio-engine';
import {
  PLAIN_PLAN_PROCESSING,
  RACKED_ASSET,
  rackedMedia,
} from '@audiogubbins/audio-engine/testing';
import {
  StandardLayouts,
  derivedSampleCount,
  sampleRate,
  streamLength,
  type EditPlan,
  DEFAULT_LOOP_CROSSFADE_SHAPE,
  type LoopDefinition,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { extendedAuditionPlan, loopAuditionPlan } from './audition-plans.js';

const RATE = expectSuccess(sampleRate(48_000));
const FRAMES = 3_000;

/** The region's audio: a ramp, so every frame is told apart from every other. */
const RAMP = Float32Array.from({ length: FRAMES }, (_, frame) => frame / FRAMES);

const LOOP: LoopDefinition = {
  loopStart: derivedSampleCount(1_000),
  loopEnd: derivedSampleCount(1_500),
  crossfadeLength: derivedSampleCount(0),
  crossfadeShape: DEFAULT_LOOP_CROSSFADE_SHAPE,
};

const whole = {
  start: derivedSampleCount(0),
  length: derivedSampleCount(FRAMES),
  reversed: false,
  stages: [],
};

/** The region's plan read straight from its file. */
const DIRECT: EditPlan = {
  streams: [
    {
      sampleRate: RATE,
      layout: StandardLayouts.mono,
      segments: [{ ...whole, source: { kind: 'media', asset: RACKED_ASSET } }],
    },
  ],
};

/** The same region whose first stream reads a second, which reads the file, as a racked region's does. */
const THROUGH_A_STREAM: EditPlan = {
  streams: [
    {
      sampleRate: RATE,
      layout: StandardLayouts.mono,
      segments: [{ ...whole, source: { kind: 'stream', stream: 1 } }],
    },
    {
      sampleRate: RATE,
      layout: StandardLayouts.mono,
      segments: [{ ...whole, source: { kind: 'media', asset: RACKED_ASSET } }],
    },
  ],
};

/** Every frame `plan` makes, rendered offline. */
async function rendered(plan: EditPlan): Promise<Float32Array> {
  const source = expectSuccess(
    describedSource(
      {
        kind: PcmDescriptionKind.Edited,
        sampleRate: RATE,
        plan,
        media: [rackedMedia([RAMP], RATE)],
      },
      StandardLayouts.mono,
      REFERENCE_DSP,
      PLAIN_PLAN_PROCESSING,
    ),
  );
  const block = allocateBlock(StandardLayouts.mono, RATE, streamLength(plan.streams[0]));
  await source.read(derivedSampleCount(0), block);
  return block.channels[0] ?? new Float32Array(0);
}

/** The region's frames `[from, to)`, repeated. */
function spans(...ranges: readonly (readonly [number, number])[]): Float32Array {
  return Float32Array.from(ranges.flatMap(([from, to]) => [...RAMP.subarray(from, to)]));
}

describe('a loop audition by cycles', () => {
  it('plays the lead-in before S, then S to E again and again', async () => {
    const audition = expectSuccess(
      loopAuditionPlan(DIRECT, LOOP, { kind: 'cycles', leadInFrames: 100 }, 3),
    );
    expect(await rendered(audition.plan)).toEqual(
      spans([900, 1_000], [1_000, 1_500], [1_000, 1_500], [1_000, 1_500]),
    );
  });

  it('reads the region through every stream its plan has, renumbered behind its own', async () => {
    const audition = expectSuccess(
      loopAuditionPlan(THROUGH_A_STREAM, LOOP, { kind: 'cycles', leadInFrames: 0 }, 2),
    );
    expect(audition.plan.streams[2]?.segments[0]?.source).toEqual({
      kind: 'media',
      asset: RACKED_ASSET,
    });
    expect(audition.plan.streams[1]?.segments[0]?.source).toEqual({ kind: 'stream', stream: 2 });
    expect(await rendered(audition.plan)).toEqual(spans([1_000, 1_500], [1_000, 1_500]));
  });

  it('takes no more lead-in than the region has before S', () => {
    const early: LoopDefinition = { ...LOOP, loopStart: derivedSampleCount(40) };
    const audition = expectSuccess(
      loopAuditionPlan(DIRECT, early, { kind: 'cycles', leadInFrames: 48_000 }, 1),
    );
    expect(audition.plan.streams[0].segments[0]?.start).toBe(0);
    expect(audition.plan.streams[0].segments[0]?.length).toBe(40);
  });
});

describe('a loop audition of the seam', () => {
  it('plays the frames before E then those from S, again and again', async () => {
    const audition = expectSuccess(
      loopAuditionPlan(DIRECT, LOOP, { kind: 'seam', sideFrames: 50 }, 2),
    );
    expect(await rendered(audition.plan)).toEqual(
      spans([1_450, 1_500], [1_000, 1_050], [1_450, 1_500], [1_000, 1_050]),
    );
  });

  it('takes no more either side than the loop', () => {
    const audition = expectSuccess(
      loopAuditionPlan(DIRECT, LOOP, { kind: 'seam', sideFrames: 24_000 }, 1),
    );
    expect(audition.cycle.map(({ start, length }) => [start, length])).toEqual([
      [1_000, 500],
      [1_000, 500],
    ]);
  });
});

describe('an audition extended by more cycles', () => {
  it('keeps every stream and every segment before its old end, and plays on', async () => {
    const audition = expectSuccess(
      loopAuditionPlan(DIRECT, LOOP, { kind: 'cycles', leadInFrames: 100 }, 1),
    );
    const extended = extendedAuditionPlan(audition, 2);
    const [first, ...rest] = extended.plan.streams;
    const [oldFirst, ...oldRest] = audition.plan.streams;
    oldFirst.segments.forEach((segment, index) => {
      expect(first.segments[index]).toBe(segment);
    });
    oldRest.forEach((stream, index) => {
      expect(rest[index]).toBe(stream);
    });
    expect(await rendered(extended.plan)).toEqual(
      spans([900, 1_000], [1_000, 1_500], [1_000, 1_500], [1_000, 1_500]),
    );
  });
});

describe('an audition that cannot be made', () => {
  it('refuses a loop outside its region, no cycle, or a lead-in that is not a whole number', () => {
    const codeOf = (result: ReturnType<typeof loopAuditionPlan>) =>
      result.ok ? undefined : result.failures[0].code;
    const outside: LoopDefinition = { ...LOOP, loopEnd: derivedSampleCount(FRAMES + 1) };
    expect(codeOf(loopAuditionPlan(DIRECT, outside, { kind: 'cycles', leadInFrames: 0 }, 1))).toBe(
      'loop.outside-region',
    );
    expect(codeOf(loopAuditionPlan(DIRECT, LOOP, { kind: 'cycles', leadInFrames: 0 }, 0))).toBe(
      'loop.audition-cycles-invalid',
    );
    expect(codeOf(loopAuditionPlan(DIRECT, LOOP, { kind: 'cycles', leadInFrames: -1 }, 1))).toBe(
      'loop.audition-span-invalid',
    );
    expect(codeOf(loopAuditionPlan(DIRECT, LOOP, { kind: 'seam', sideFrames: 0 }, 1))).toBe(
      'loop.audition-span-invalid',
    );
  });
});
