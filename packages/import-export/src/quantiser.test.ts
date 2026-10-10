import { describe, expect, it } from 'vitest';

import { quantiseSample } from '@audiogubbins/codecs';

import { defaultExportSettings } from './default-settings.js';
import { ditherKey } from './dither-key.js';
import type { DitherSettings, NoiseShaping } from './export-settings.js';
import { Quantiser } from './quantiser.js';
import { contextOf } from './testing/export-fixtures.js';

const KEY = 0x1234_5678;
const FRAMES = 4_096;

function triangular(
  shaping: NoiseShaping = 'none',
  amplitude = 1,
): Exclude<DitherSettings, { kind: 'none' }> {
  return { kind: 'triangular', amplitude, shaping, seed: 0 };
}

/** Two channels of a quiet, slowly moving signal that falls between 16-bit steps. */
function signal(frames = FRAMES, level = 0.001): readonly Float32Array[] {
  return [0, 1].map((channel) =>
    Float32Array.from({ length: frames }, (_, frame) =>
      Math.fround(level * Math.sin((frame + channel * 17) / 23)),
    ),
  );
}

/** The whole signal quantised in blocks of `block` frames. */
function quantised(
  dither: DitherSettings,
  input: readonly Float32Array[],
  options: { readonly block?: number; readonly bits?: number; readonly key?: number } = {},
): readonly Float64Array[] {
  const quantiser = new Quantiser({
    bits: options.bits ?? 16,
    dither,
    key: options.key ?? KEY,
    channels: input.length,
  });
  const frames = input[0]?.length ?? 0;
  const output = input.map(() => new Float64Array(frames));
  const block = options.block ?? frames;
  for (let start = 0; start < frames; start += block) {
    const length = Math.min(block, frames - start);
    quantiser.quantise(
      input.map((channel) => channel.subarray(start, start + length)),
      length,
      output.map((channel) => channel.subarray(start, start + length)),
    );
  }
  return output;
}

/** The error of each frame of the first channel, in steps of 16 bits. */
function errorOf(input: readonly Float32Array[], output: readonly Float64Array[]): Float64Array {
  const [from = new Float32Array(), to = new Float64Array()] = [input[0], output[0]];
  return Float64Array.from(to, (value, frame) => (value - (from[frame] ?? 0)) * 2 ** 15);
}

/** The error's power near `hertz` at 44.1 kHz, by the Goertzel recurrence. */
function powerAt(error: Float64Array, hertz: number): number {
  const coefficient = 2 * Math.cos((2 * Math.PI * hertz) / 44_100);
  let previous = 0;
  let before = 0;
  for (const value of error) {
    const next = value + coefficient * previous - before;
    before = previous;
    previous = next;
  }
  return previous * previous + before * before - coefficient * previous * before;
}

describe('quantisation', () => {
  it('gives values each exactly k / 2^(bits-1), the integer quantiseSample gives back', () => {
    for (const bits of [8, 16, 24, 32]) {
      const scale = 2 ** (bits - 1);
      for (const dither of [{ kind: 'none' } as const, triangular(), triangular('first-order')]) {
        for (const value of quantised(dither, signal(512), { bits })[0] ?? []) {
          const integer = value * scale;
          expect(Number.isInteger(integer)).toBe(true);
          expect(quantiseSample(value, bits)).toBe(integer);
        }
      }
    }
  });

  it('without dither, is quantiseSample of each sample', () => {
    const input = signal();
    const output = quantised({ kind: 'none' }, input);
    output.forEach((channel, index) => {
      channel.forEach((value, frame) => {
        expect(value).toBe(quantiseSample(input[index]?.[frame] ?? 0, 16) / 2 ** 15);
      });
    });
  });

  it('gives the same bits whatever blocks the audio arrives in', () => {
    const input = signal();
    for (const dither of [
      { kind: 'rectangular', amplitude: 1, shaping: 'none', seed: 0 } as const,
      triangular(),
      triangular('first-order'),
      triangular('lipshitz-e-weighted'),
    ]) {
      const whole = quantised(dither, input);
      for (const block of [1, 7, 128, 1_000]) {
        expect(quantised(dither, input, { block })).toEqual(whole);
      }
    }
  });

  it('gives the same bits for the same key, and others for another', () => {
    const input = signal();
    expect(quantised(triangular(), input)).toEqual(quantised(triangular(), input));
    expect(quantised(triangular(), input, { key: KEY + 1 })).not.toEqual(
      quantised(triangular(), input),
    );
  });

  it('draws each channel its own noise', () => {
    const silence = [new Float32Array(FRAMES), new Float32Array(FRAMES)];
    const [left, right] = quantised(triangular(), silence);
    expect(left).not.toEqual(right);
  });

  it('keeps rectangular noise within half its width and triangular within its width, centred', () => {
    const silence = [new Float32Array(FRAMES)];
    const width = 2;
    for (const [dither, peak] of [
      [{ kind: 'rectangular', amplitude: width, shaping: 'none', seed: 0 } as const, width / 2],
      [triangular('none', width), width],
    ] as const) {
      const error = errorOf(silence, quantised(dither, silence));
      // Quantising moves a sample by at most half a step past the noise.
      expect(Math.max(...error.map(Math.abs))).toBeLessThanOrEqual(peak + 0.5);
      expect(Math.abs(error.reduce((sum, value) => sum + value, 0) / error.length)).toBeLessThan(
        0.1,
      );
    }
  });

  it('dithers a signal below one step into the output, where none leaves silence', () => {
    const tiny = [Float32Array.from({ length: FRAMES }, () => 0.2 / 2 ** 15)];
    expect(quantised({ kind: 'none' }, tiny)[0]?.every((value) => value === 0)).toBe(true);
    expect(quantised(triangular(), tiny)[0]?.some((value) => value !== 0)).toBe(true);
  });

  it('moves the error away from low frequencies with first-order shaping', () => {
    const input = signal();
    const plain = powerAt(errorOf(input, quantised(triangular(), input)), 200);
    const shaped = powerAt(errorOf(input, quantised(triangular('first-order'), input)), 200);
    expect(shaped).toBeLessThan(plain / 10);
  });

  it('lowers the error where the ear is most sensitive with the E-weighted shaping', () => {
    const input = signal(44_100);
    const plain = powerAt(errorOf(input, quantised(triangular(), input)), 3_000);
    const shaped = powerAt(
      errorOf(input, quantised(triangular('lipshitz-e-weighted'), input)),
      3_000,
    );
    expect(shaped).toBeLessThan(plain / 10);
  });

  it('feeds back no overload, so shaping settles once a clipped passage ends', () => {
    const frames = 2_000;
    const input = [
      Float32Array.from({ length: frames }, (_, frame) => (frame < 1_000 ? 1.5 : 0.001)),
    ];
    const error = errorOf(input, quantised(triangular('lipshitz-e-weighted'), input));
    expect(error.every(Number.isFinite)).toBe(true);
    // The E-weighted filter's gain past about 13 kHz bounds the settled error well inside 64 steps.
    expect(Math.max(...error.subarray(1_100).map(Math.abs))).toBeLessThan(64);
  });

  it('refuses to write a depth past 24 bits into a 32-bit float', () => {
    const quantiser = new Quantiser({ bits: 32, dither: { kind: 'none' }, key: 0, channels: 1 });
    expect(() => {
      quantiser.quantise([new Float32Array(4)], 4, [new Float32Array(4)]);
    }).toThrow(RangeError);
  });
});

describe('the dither key', () => {
  it("is the settings', whatever order their keys were written in, and changes with the seed", () => {
    const settings = defaultExportSettings(
      'flac',
      contextOf({ precision: { kind: 'integer', bits: 16 } }),
    );
    const { format, encoding, dither, ...rest } = settings;
    const reordered = {
      dither: { ...dither },
      encoding: { compressionLevel: encoding.compressionLevel, bits: encoding.bits },
      ...rest,
      format,
    };
    expect(Object.keys(reordered)).not.toEqual(Object.keys(settings));
    expect(ditherKey(reordered)).toBe(ditherKey(settings));
    expect(ditherKey({ ...settings, dither: triangular() })).not.toBe(
      ditherKey({ ...settings, dither: { ...triangular(), seed: 1 } }),
    );
    expect(ditherKey(settings)).toBe(ditherKey(structuredClone(settings)));
  });
});
