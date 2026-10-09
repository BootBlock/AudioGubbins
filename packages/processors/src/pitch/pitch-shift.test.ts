import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_QUALITY,
  StandardLayouts,
  namedQualityMode,
  sampleRate,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { fingerprint } from '@audiogubbins/audio-engine/testing';

import {
  TEST_RATE,
  processorKernel,
  processorValues,
  runProcessor,
} from '../testing/processor-run.js';
import {
  decibelsOf,
  fittedTone,
  loudestFrequency,
  rootMeanSquare,
  tones,
} from '../testing/pitch-measures.js';
import { setLayout } from '../testing/space-measures.js';
import { PITCH_SHIFT } from './pitch-shift.js';

/** The latency at the test rate: the 4096-frame window, less one. */
const LATENCY = 4_095;
const LENGTH = 96_000;
/** Where the measures start, well past the first frames, and how long they run. */
const FROM = 20_000;
const SPAN = 65_536;

function ratioOf(semitones: number, cents: number): number {
  return 2 ** ((semitones + cents / 100) / 12);
}

function shiftedMono(input: Float32Array, values: Readonly<Record<string, number>>): Float32Array {
  const [output] = runProcessor(PITCH_SHIFT, { layout: StandardLayouts.mono, values }, [input]);
  return output ?? new Float32Array(0);
}

describe('the pitch shift', () => {
  it('moves a tone by the semitones and cents asked for, at the level it had', () => {
    const input = tones([{ frequency: 440, amplitude: 0.5 }], LENGTH);
    for (const [semitones, cents] of [
      [7, 0],
      [-5, -50],
      [0, 30],
      [19, 0],
    ] as const) {
      const out = shiftedMono(input, { semitones, cents });
      const target = 440 * ratioOf(semitones, cents);
      expect(Math.abs(loudestFrequency(out, FROM, SPAN) - target)).toBeLessThan(0.1);
      const level = fittedTone(out, target, FROM, SPAN).amplitude;
      expect(Math.abs(decibelsOf(level / 0.5))).toBeLessThan(0.05);
    }
  });

  it('keeps the amplitude ratio of two tones within 1 dB', () => {
    const input = tones(
      [
        { frequency: 440, amplitude: 0.4 },
        { frequency: 1_250, amplitude: 0.1 },
      ],
      LENGTH,
    );
    for (const semitones of [5, -7, 12]) {
      const ratio = ratioOf(semitones, 0);
      const out = shiftedMono(input, { semitones });
      const low = fittedTone(out, 440 * ratio, FROM, SPAN).amplitude;
      const high = fittedTone(out, 1_250 * ratio, FROM, SPAN).amplitude;
      expect(Math.abs(decibelsOf(low / high) - decibelsOf(4))).toBeLessThan(1);
    }
  });

  it('keeps a gliding tone at a steady level as its partial crosses the bins', () => {
    // From 300 Hz rising 150 Hz a second, so the move of its bins changes
    // from frame to frame: a move that changed the polarity of the bins it
    // moved would cancel the frames either side of each change.
    const input = Float32Array.from({ length: LENGTH }, (_, frame) => {
      const seconds = frame / TEST_RATE;
      return 0.5 * Math.sin(2 * Math.PI * (300 * seconds + 75 * seconds * seconds));
    });
    for (const semitones of [5, -7, 12]) {
      const out = shiftedMono(input, { semitones });
      let least = Number.POSITIVE_INFINITY;
      let most = 0;
      for (let frame = 8_192; frame + 1_024 < LENGTH - LATENCY; frame += 512) {
        const level = rootMeanSquare(out, frame, 1_024);
        least = Math.min(least, level);
        most = Math.max(most, level);
      }
      expect(decibelsOf(most / least)).toBeLessThan(1);
    }
  });

  it('keeps the timing: a burst starts and ends where it did, later by the latency', () => {
    const tone = tones([{ frequency: 440, amplitude: 0.5 }], LENGTH);
    const input = tone.map((sample, frame) => (frame >= 24_000 && frame < 72_000 ? sample : 0));
    for (const level of ['draft', 'maximum'] as const) {
      const [out = new Float32Array(0)] = runProcessor(
        PITCH_SHIFT,
        {
          layout: StandardLayouts.mono,
          values: { semitones: 7 },
          quality: namedQualityMode(level).settings,
        },
        [input],
      );
      expect(out.length).toBe(LENGTH);
      const steady = rootMeanSquare(out, 40_000 + LATENCY, 20_000);
      const loud = (frame: number) => rootMeanSquare(out, frame - 120, 240) > steady / 2;
      const onset = out.findIndex((_, frame) => frame >= 120 && loud(frame));
      const after = onset + 1_000;
      const offset = after + out.subarray(after).findIndex((_, frame) => !loud(after + frame));
      // A frame spreads its shift over its whole length, so an edge is
      // smeared by a fraction of the window, not moved.
      expect(Math.abs(onset - (24_000 + LATENCY))).toBeLessThan(128);
      expect(Math.abs(offset - (72_000 + LATENCY))).toBeLessThan(128);
    }
  });

  it('keeps each source of a stereo image at its level difference within 0.5 dB', () => {
    // Two sources panned by the sine–cosine law, one 30° and one 70° of the
    // 90° from the left channel to the right.
    const pan = (degrees: number) => [
      Math.cos((degrees * Math.PI) / 180),
      Math.sin((degrees * Math.PI) / 180),
    ];
    const sources = [
      { frequency: 440, gains: pan(30), tone: tones([{ frequency: 440, amplitude: 0.4 }], LENGTH) },
      {
        frequency: 1_000,
        gains: pan(70),
        tone: tones([{ frequency: 1_000, amplitude: 0.3 }], LENGTH),
      },
    ];
    const channel = (side: number) =>
      Float32Array.from({ length: LENGTH }, (_, frame) =>
        sources.reduce((sum, { gains, tone }) => sum + (gains[side] ?? 0) * (tone[frame] ?? 0), 0),
      );
    const ratio = ratioOf(5, 0);
    const [left = new Float32Array(0), right = new Float32Array(0)] = runProcessor(
      PITCH_SHIFT,
      { layout: StandardLayouts.stereo, values: { semitones: 5 } },
      [channel(0), channel(1)],
    );
    for (const { frequency, gains } of sources) {
      const shifted = frequency * ratio;
      const difference = decibelsOf(
        fittedTone(left, shifted, FROM, SPAN).amplitude /
          fittedTone(right, shifted, FROM, SPAN).amplitude,
      );
      expect(Math.abs(difference - decibelsOf((gains[0] ?? 0) / (gains[1] ?? 1)))).toBeLessThan(
        0.5,
      );
    }
  });

  it('keeps the direction of a source in an ambisonic set', () => {
    // A first-order AmbiX set (W, Y, Z, X in SN3D) of one source at 60°
    // azimuth and 20° elevation: each component the source times its gain.
    const azimuth = Math.PI / 3;
    const elevation = Math.PI / 9;
    const gains = [
      1,
      Math.sin(azimuth) * Math.cos(elevation),
      Math.sin(elevation),
      Math.cos(azimuth) * Math.cos(elevation),
    ];
    const source = tones(
      [
        { frequency: 330, amplitude: 0.3 },
        { frequency: 870, amplitude: 0.15 },
      ],
      LENGTH,
    );
    const set = gains.map((gain) => source.map((sample) => gain * sample));
    const out = runProcessor(
      PITCH_SHIFT,
      { layout: setLayout(1, 'sn3d'), values: { semitones: -3, cents: 40 } },
      set,
    );
    const ratio = ratioOf(-3, 40);
    for (const frequency of [330, 870]) {
      const omni = fittedTone(out[0] ?? new Float32Array(0), frequency * ratio, FROM, SPAN);
      for (const [component, gain] of gains.entries()) {
        const fitted = fittedTone(
          out[component] ?? new Float32Array(0),
          frequency * ratio,
          FROM,
          SPAN,
        );
        // Each component the omni's level times its gain, in the omni's phase.
        expect(fitted.amplitude).toBeCloseTo(omni.amplitude * Math.abs(gain), 4);
        expect(Math.cos(fitted.phase - omni.phase)).toBeGreaterThan(0.9999);
      }
    }
  });

  it('glides to a pitch moved while it plays, the same bits however it is cut', () => {
    const input = [tones([{ frequency: 440, amplitude: 0.5 }], 2 * LENGTH)];
    const change = { frame: LENGTH, name: 'semitones', value: 12 };
    const settings = { layout: StandardLayouts.mono };
    const whole = runProcessor(PITCH_SHIFT, settings, input, [4_096], change);
    const cut = runProcessor(PITCH_SHIFT, settings, input, [1, 7, 128, 333], change);
    expect(fingerprint(cut[0] ?? new Float32Array(0))).toBe(
      fingerprint(whole[0] ?? new Float32Array(0)),
    );
    const out = whole[0] ?? new Float32Array(0);
    expect(Math.abs(loudestFrequency(out, FROM, SPAN) - 440)).toBeLessThan(0.1);
    expect(Math.abs(loudestFrequency(out, LENGTH + FROM, SPAN) - 880)).toBeLessThan(0.1);
  });

  it('refuses a pitch outside its range and a parameter it does not have', () => {
    const { kernel } = processorKernel(PITCH_SHIFT, { layout: StandardLayouts.stereo });
    expect(expectFailureCode(kernel.setParameter('semitones', 25))).toBe('node.parameter-invalid');
    expect(expectFailureCode(kernel.setParameter('cents', -101))).toBe('node.parameter-invalid');
    expect(expectFailureCode(kernel.setParameter('formant', 1))).toBe('node.parameter-unknown');
    expect(kernel.setParameter('cents', -100).ok).toBe(true);
    kernel.release();
  });

  it('declares the window less one as its latency and its lead-in at each rate', () => {
    const values = processorValues(PITCH_SHIFT);
    for (const [rate, window] of [
      [8_000, 1_024],
      [44_100, 4_096],
      [TEST_RATE, 4_096],
      [96_000, 8_192],
    ] as const) {
      const settings = {
        values,
        sampleRate: expectSuccess(sampleRate(rate)),
        quality: MAXIMUM_QUALITY.settings,
      };
      expect(PITCH_SHIFT.descriptor.latency(settings)).toEqual({
        kind: 'known',
        frames: window - 1,
      });
      expect(PITCH_SHIFT.descriptor.leadIn(settings)).toBe(window - 1);
    }
  });

  it('puts an impulse at no shift on the frame its latency names, at every overlap', () => {
    const impulse = new Float32Array(16_384);
    impulse[1_000] = 1;
    for (const level of ['draft', 'standard', 'maximum'] as const) {
      const out =
        runProcessor(
          PITCH_SHIFT,
          { layout: StandardLayouts.mono, values: {}, quality: namedQualityMode(level).settings },
          [impulse],
        )[0] ?? new Float32Array(0);
      expect(out[1_000 + LATENCY]).toBeCloseTo(1, 6);
      let elsewhere = 0;
      for (const [frame, sample] of out.entries()) {
        if (frame !== 1_000 + LATENCY) elsewhere = Math.max(elsewhere, Math.abs(sample));
      }
      expect(elsewhere).toBeLessThan(1e-6);
    }
  });
});
