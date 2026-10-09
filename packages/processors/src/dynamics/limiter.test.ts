import { describe, expect, it } from 'vitest';

import { MAXIMUM_QUALITY, StandardLayouts, sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { chirp, noisySine } from '@audiogubbins/test-fixtures';

import { processorKernel, processorValues, runProcessor } from '../testing/processor-run.js';
import { LIMITER } from './limiter.js';

const OVERSAMPLINGS = [1, 2, 4, 8] as const;

/** Programme 12 dB over full scale, a channel of noise and tone and one of a sweep. */
function loudProgramme(): Float32Array[] {
  return [noisySine(440).channels[0], chirp().channels[0]].map((channel) =>
    Float32Array.from(channel ?? new Float32Array(0), (sample) => sample * 4),
  );
}

describe('the limiter', () => {
  it('never lets a sample past its ceiling, at every oversampling', () => {
    for (const oversampling of OVERSAMPLINGS) {
      for (const ceiling of [-1, -6]) {
        const out = runProcessor(
          LIMITER,
          {
            layout: StandardLayouts.stereo,
            values: { ceiling, 'look-ahead': 1 },
            quality: { ...MAXIMUM_QUALITY.settings, oversampling },
          },
          loudProgramme(),
          [1, 7, 128, 333],
        );
        const peak = Math.max(...out.map((channel) => Math.max(...channel.map(Math.abs))));
        expect(peak).toBeLessThanOrEqual(10 ** (ceiling / 20));
      }
    }
  });

  it('counts its look-ahead in whole frames, a half rounded up', () => {
    const at = (rate: number, milliseconds: number, oversampling: 1 | 8) =>
      LIMITER.descriptor.latency({
        values: processorValues(LIMITER, { 'look-ahead': milliseconds }),
        sampleRate: expectSuccess(sampleRate(rate)),
        quality: { ...MAXIMUM_QUALITY.settings, oversampling },
      });
    // 5 ms at 44.1 kHz is 220.5 frames.
    expect(at(44_100, 5, 1)).toEqual({ kind: 'known', frames: 221 });
    expect(at(48_000, 5, 1)).toEqual({ kind: 'known', frames: 240 });
    // Above one rate the detector adds the 6 frames the meter's filter reads
    // ahead and 6 held on each side, and nothing from 192 kHz, where the meter
    // reads no points between frames.
    expect(at(48_000, 5, 8)).toEqual({ kind: 'known', frames: 252 });
    expect(at(192_000, 5, 8)).toEqual({ kind: 'known', frames: 960 });
  });

  it('moves its ceiling while it plays, and refuses to move its look-ahead', () => {
    const { kernel } = processorKernel(LIMITER, { layout: StandardLayouts.mono });
    expect(kernel.setParameter('ceiling', -3).ok).toBe(true);
    expect(kernel.setParameter('release', 500).ok).toBe(true);
    expect(kernel.setParameter('ceiling', 1).ok).toBe(false);
    expect(kernel.setParameter('look-ahead', 10).ok).toBe(false);
  });
});
