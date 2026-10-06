import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { REFERENCE_DSP, blockView, type AudioFrameBlock } from '@audiogubbins/audio-engine';
import { chirp, noise } from '@audiogubbins/test-fixtures';

import { TEST_RATE } from '../testing/processor-run.js';
import { FrameAnalysis } from './frame-analysis.js';
import { OverlapAdd, type SpectralTransform } from './overlap-add.js';

/** A change that leaves every frame as it was analysed. */
const UNCHANGED: SpectralTransform = { transform: () => undefined };

/** `input` through the transform and back at `size` and `hop`, in blocks of `block`. */
function throughAndBack(
  input: readonly Float32Array[],
  size: number,
  hop: number,
  block: number,
): Float32Array[] {
  const fft = expectSuccess(REFERENCE_DSP.createFft(size));
  const overlap = new OverlapAdd(new FrameAnalysis(fft, input.length, hop));
  const length = input[0]?.length ?? 0;
  const layout = input.length === 1 ? StandardLayouts.mono : StandardLayouts.stereo;
  const whole = (channels: readonly Float32Array[]): AudioFrameBlock => ({
    layout,
    sampleRate: TEST_RATE,
    frames: length,
    channels,
  });
  const source = whole(input);
  const sink = whole(input.map(() => new Float32Array(length)));
  for (let position = 0; position < length; position += block) {
    const frames = Math.min(block, length - position);
    overlap.process(
      blockView(source, position, frames),
      blockView(sink, position, frames),
      frames,
      UNCHANGED,
    );
  }
  overlap.analysis.release();
  return [...sink.channels];
}

describe('the spectral processors’ short-time Fourier transform', () => {
  it('gives its input back, N − 1 frames late, when no frame is changed', () => {
    const input = [
      noise(9, { length: 20_000, amplitude: 0.9 }).channels[0] ?? new Float32Array(0),
      (chirp().channels[0] ?? new Float32Array(0)).slice(0, 20_000),
    ];
    for (const [size, hop] of [
      [1_024, 512],
      [2_048, 512],
      [4_096, 512],
      [256, 128],
    ] as const) {
      const out = throughAndBack(input, size, hop, 333);
      for (const [channel, samples] of out.entries()) {
        const source = input[channel] ?? new Float32Array(0);
        let worst = 0;
        for (let frame = 0; frame < samples.length; frame += 1) {
          const expected = frame < size - 1 ? 0 : (source[frame - (size - 1)] ?? 0);
          worst = Math.max(worst, Math.abs((samples[frame] ?? 0) - expected));
        }
        expect(worst).toBeLessThanOrEqual(1e-6);
      }
    }
  });

  it('windows by the square root of the periodic Hann window, whose squares overlap to a constant', () => {
    const size = 64;
    const { window } = new FrameAnalysis(expectSuccess(REFERENCE_DSP.createFft(size)), 1, size / 4);
    expect(window[0]).toBe(0);
    expect(window[size / 2]).toBeCloseTo(1, 15);
    // Copies of the squared window a quarter of it apart sum to 2 at every sample.
    for (let sample = 0; sample < size / 4; sample += 1) {
      let sum = 0;
      for (let copy = 0; copy < 4; copy += 1) sum += (window[sample + (copy * size) / 4] ?? 0) ** 2;
      expect(sum).toBeCloseTo(2, 12);
    }
  });
});
