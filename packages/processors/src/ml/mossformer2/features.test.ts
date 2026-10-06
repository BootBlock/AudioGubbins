import { describe, expect, it } from 'vitest';

import { REFERENCE_DSP } from '@audiogubbins/audio-engine';

import { FeatureMaker } from './features.js';
import { FEATURES, FRAME, HOP, MEL_BANDS, framesOf } from './mossformer2-model.js';

const RATE = 48_000;

/** Two tones and a ramp, at full scale 1, as single-precision samples. */
function signal(length: number): Float32Array {
  return Float32Array.from(
    { length },
    (_, n) =>
      0.3 * Math.sin((2 * Math.PI * 440 * n) / RATE) +
      0.2 * Math.sin((2 * Math.PI * 3_150 * n) / RATE) +
      0.1 * (((n * 7) % 113) / 113 - 0.5),
  );
}

/**
 * Kaldi's log mel filter bank by its definition, written out step by step
 * with the platform's arithmetic: each frame's mean removed, pre-emphasised,
 * Hamming-windowed, padded to 2 048, its power spectrum by the sum of the
 * discrete Fourier transform, and the triangles on the mel scale.
 */
function directLogEnergies(samples: Float32Array): number[][] {
  const padded = 2_048;
  const melOf = (frequency: number) => 1127 * Math.log(1 + frequency / 700);
  const low = melOf(20);
  const step = (melOf(RATE / 2) - low) / (MEL_BANDS + 1);
  const rows: number[][] = [];
  for (let start = 0; start + FRAME <= samples.length; start += HOP) {
    const frame = Array.from({ length: FRAME }, (_, n) => (samples[start + n] ?? 0) * 32_768);
    const mean = frame.reduce((sum, sample) => sum + sample, 0) / FRAME;
    const centred = frame.map((sample) => sample - mean);
    const emphasised = centred.map(
      (sample, n) => sample - 0.97 * (n === 0 ? sample : (centred[n - 1] ?? 0)),
    );
    const windowed = emphasised.map(
      (sample, n) => sample * (0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (FRAME - 1))),
    );
    const power = Array.from({ length: padded / 2 }, (_, bin) => {
      let real = 0;
      let imaginary = 0;
      for (const [n, sample] of windowed.entries()) {
        const angle = (2 * Math.PI * ((bin * n) % padded)) / padded;
        real += sample * Math.cos(angle);
        imaginary -= sample * Math.sin(angle);
      }
      return real * real + imaginary * imaginary;
    });
    rows.push(
      Array.from({ length: MEL_BANDS }, (_, band) => {
        let energy = 0;
        for (const [bin, value] of power.entries()) {
          const at = melOf((bin * RATE) / padded);
          const left = low + band * step;
          const centre = left + step;
          const right = centre + step;
          const rising = (at - left) / (centre - left);
          const falling = (right - at) / (right - centre);
          energy += value * Math.max(0, Math.min(rising, falling));
        }
        return Math.log(Math.max(energy, 2 ** -23));
      }),
    );
  }
  return rows;
}

function featuresOf(samples: Float32Array): Float32Array {
  const maker = new FeatureMaker(REFERENCE_DSP, samples.length);
  const features = maker.features(samples);
  maker.release();
  return features;
}

describe("MossFormer2 SE 48K's features", () => {
  // A tenth of a second: eight frames.
  const samples = signal(4_800);

  it('are Kaldi’s log mel filter bank by its definition, frame by frame', () => {
    const features = featuresOf(samples);
    const direct = directLogEnergies(samples);
    expect(direct).toHaveLength(framesOf(samples.length));
    let largest = 0;
    for (const [frame, row] of direct.entries()) {
      for (const [band, value] of row.entries()) {
        // The port rounds each to single precision, as the graph takes it.
        largest = Math.max(largest, Math.abs((features[frame * FEATURES + band] ?? 0) - value));
      }
    }
    expect(largest).toBeLessThan(4e-6);
  });

  it('carry each band’s deltas and second deltas, the edges repeated', () => {
    const features = featuresOf(samples);
    const frames = framesOf(samples.length);
    const at = (group: number, frame: number, band: number) =>
      features[Math.min(frames - 1, Math.max(0, frame)) * FEATURES + group * MEL_BANDS + band] ?? 0;
    let largest = 0;
    for (let frame = 0; frame < frames; frame += 1) {
      for (let band = 0; band < MEL_BANDS; band += 1) {
        for (const group of [1, 2]) {
          const of = group - 1;
          const expected =
            (-2 * at(of, frame - 2, band) -
              at(of, frame - 1, band) +
              at(of, frame + 1, band) +
              2 * at(of, frame + 2, band)) /
            10;
          largest = Math.max(largest, Math.abs(at(group, frame, band) - expected));
        }
      }
    }
    expect(largest).toBeLessThan(1e-6);
  });

  it('are what torchaudio makes of the same signal, within its single precision', () => {
    // torchaudio 2.9.1's `kaldi.fbank` (dither off) and `compute_deltas`, as
    // ClearerVoice-Studio's decode calls them, of this signal: frames 0, 3
    // and 7 at bands 0, 29 and 59 of the bank, its deltas and its second
    // deltas. torchaudio computes in single precision, which leaves its log
    // energies, about 20, within 4·10⁻⁵ of the exact ones.
    const torchaudio: Readonly<Record<number, readonly number[]>> = {
      0: [
        13.645112, 21.769751, 22.981104, -0.027877808, -0.00095138547, 0.00012207031, -0.0024316213,
        0.000093383773, -0.000026855469,
      ],
      3: [
        13.122056, 21.767267, 22.981152, -0.15563087, 0.00062599184, -0.0001335144, 0.098360732,
        0.00029327394, -0.0000068664544,
      ],
      7: [
        14.501345, 21.769917, 22.98143, 0.36409932, 0.00058555603, 0.0001083374, 0.027819484,
        -0.0000072479247, 0.000017700197,
      ],
    };
    const features = featuresOf(samples);
    for (const [frame, expected] of Object.entries(torchaudio)) {
      const found = [0, 1, 2].flatMap((group) =>
        [0, 29, 59].map(
          (band) => features[Number(frame) * FEATURES + group * MEL_BANDS + band] ?? 0,
        ),
      );
      for (const [index, value] of expected.entries()) {
        expect(
          Math.abs((found[index] ?? 0) - value),
          `frame ${frame}, value ${String(index)}`,
        ).toBeLessThan(5e-5);
      }
    }
  });
});
