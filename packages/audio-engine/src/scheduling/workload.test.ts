import { describe, expect, it } from 'vitest';

import { sampleCount, sampleRate, type SampleCount, type SampleRate } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import { PerformanceProfile, PRESET_SETTINGS } from '../profiles/performance-profile.js';
import { estimateWorkload, planChunks, type ChunkPlanRequest } from './workload.js';

const RATE: SampleRate = expectSuccess(sampleRate(48_000));
const BALANCED = PRESET_SETTINGS[PerformanceProfile.Balanced];

function frames(value: number): SampleCount {
  return expectSuccess(sampleCount(value));
}

/** Two hours of 5.1 at 48 kHz: about 8.3 GB as planar float. */
const TWO_HOURS_SURROUND: ChunkPlanRequest = {
  frames: frames(2 * 3_600 * 48_000),
  channels: 6,
  sampleRate: RATE,
  settings: BALANCED,
};

describe('estimating a workload', () => {
  it('reports the bytes held whole as planar 32-bit float, and the audio duration', () => {
    expect(
      expectSuccess(estimateWorkload({ frames: frames(96_000), channels: 2, sampleRate: RATE })),
    ).toEqual({
      bytesHeldWhole: 96_000 * 2 * 4,
      audioSeconds: 2,
      coefficientTableBytes: 0,
      computedConversions: 0,
    });
  });

  it('estimates a very long recording without limit', () => {
    const tenDays = frames(10 * 24 * 3_600 * 48_000);
    const estimate = expectSuccess(
      estimateWorkload({ frames: tenDays, channels: 256, sampleRate: RATE }),
    );
    expect(estimate.bytesHeldWhole).toBe(10 * 24 * 3_600 * 48_000 * 256 * 4);
    expect(estimate.audioSeconds).toBe(10 * 24 * 3_600);
  });

  it.each([0, -1, 1.5, 257, Number.NaN])('refuses %s channels', (channels) => {
    expect(
      expectFailureCode(estimateWorkload({ frames: frames(1), channels, sampleRate: RATE })),
    ).toBe('workload.channels-invalid');
  });
});

describe('planning chunks', () => {
  it('chunks by the profile chunk length at the rate', () => {
    const plan = expectSuccess(planChunks({ ...TWO_HOURS_SURROUND, availableMemoryBytes: 64e9 }));
    // Balanced renders 500 ms chunks: 24 000 frames at 48 kHz.
    expect(plan.chunkFrames).toBe(24_000);
    expect(plan.chunks).toBe(14_400);
    expect(plan.warnings).toEqual([]);
  });

  it('chunks even when the whole would fit, never holding the whole file by default', () => {
    const plan = expectSuccess(
      planChunks({
        ...TWO_HOURS_SURROUND,
        frames: frames(480_000),
        availableMemoryBytes: Number.MAX_SAFE_INTEGER,
      }),
    );
    expect(plan.chunkFrames).toBeLessThan(480_000);
    expect(plan.chunks).toBe(20);
  });

  it('proceeds in chunks with a warning when the whole exceeds the memory available', () => {
    const plan = expectSuccess(planChunks({ ...TWO_HOURS_SURROUND, availableMemoryBytes: 4e9 }));
    expect(plan.chunks).toBe(14_400);
    expect(plan.warnings).toHaveLength(1);
    const [warning] = plan.warnings;
    expect(warning).toMatchObject({
      resource: 'memory',
      needed: 2 * 3_600 * 48_000 * 6 * 4,
      available: 4e9,
    });
    expect(warning!.explanation).toBe(
      'Holding all of this audio at once would need 8.3 GB of memory, and about 4.0 GB is available. ' +
        'Memory is the limiting resource.',
    );
    expect(warning!.saferStrategy).toBe(
      'Process it in 14400 chunks of 500 ms, holding about 576.0 kB at a time. It takes longer, and it finishes.',
    );
  });

  it('shrinks the chunk to fit when even one chunk would not, and still proceeds', () => {
    const plan = expectSuccess(planChunks({ ...TWO_HOURS_SURROUND, availableMemoryBytes: 2_400 }));
    // 2 400 bytes hold 100 frames of six float channels.
    expect(plan.chunkFrames).toBe(100);
    expect(plan.chunks).toBe(3_456_000);
    expect(plan.warnings[0]!.saferStrategy).toContain('chunks of 2 ms');
  });

  it('plans at least one frame per chunk, whatever the memory or chunk length', () => {
    expect(
      expectSuccess(planChunks({ ...TWO_HOURS_SURROUND, availableMemoryBytes: 0 })).chunkFrames,
    ).toBe(1);
    const tiny = { ...BALANCED, renderChunkMilliseconds: 0.001 };
    expect(expectSuccess(planChunks({ ...TWO_HOURS_SURROUND, settings: tiny })).chunkFrames).toBe(
      1,
    );
  });

  it('neither warns nor assumes when the available memory is unknown, and still chunks', () => {
    const plan = expectSuccess(planChunks(TWO_HOURS_SURROUND));
    expect(plan).toEqual({ chunkFrames: 24_000, chunks: 14_400, warnings: [] });
  });

  it('plans one chunk the size of a workload shorter than a chunk, and none for an empty one', () => {
    expect(
      expectSuccess(planChunks({ ...TWO_HOURS_SURROUND, frames: frames(1_000) })),
    ).toMatchObject({
      chunkFrames: 1_000,
      chunks: 1,
    });
    expect(expectSuccess(planChunks({ ...TWO_HOURS_SURROUND, frames: frames(0) })).chunks).toBe(0);
  });

  it('follows the profile: shorter chunks under Low Latency, longer under Maximum Stability', () => {
    const chunkOf = (profile: keyof typeof PRESET_SETTINGS) =>
      expectSuccess(planChunks({ ...TWO_HOURS_SURROUND, settings: PRESET_SETTINGS[profile] }))
        .chunkFrames;
    expect(chunkOf(PerformanceProfile.LowLatency)).toBe(4_800);
    expect(chunkOf(PerformanceProfile.MaximumStability)).toBe(48_000);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses an available memory of %s',
    (availableMemoryBytes) => {
      expect(expectFailureCode(planChunks({ ...TWO_HOURS_SURROUND, availableMemoryBytes }))).toBe(
        'workload.available-memory-invalid',
      );
    },
  );

  it('refuses a malformed channel count', () => {
    expect(expectFailureCode(planChunks({ ...TWO_HOURS_SURROUND, channels: 0 }))).toBe(
      'workload.channels-invalid',
    );
  });
});
