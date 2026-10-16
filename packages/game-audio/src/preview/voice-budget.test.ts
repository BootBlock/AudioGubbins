/**
 * The preview's voice budget (the plan's Q5): its bound on a varispeed's taps
 * against the canonical resampler itself, the budgets it gives, and the
 * measurement it rests on, the budget's voices played in real time with half
 * of every second to spare on the reference machine.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { ResamplingGrade, VARISPEED_DENOMINATOR, sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  VARISPEED_MOST_TAPS,
  resamplingQualityOf,
  wasmDsp,
  type CanonicalDsp,
} from '@audiogubbins/audio-engine';
import { dspModuleExports } from '@audiogubbins/audio-engine/testing';

import { DEFAULT_VOICE_VARIATION, type VoiceVariation } from '../policy/playback-rules.js';
import { pitchNumerator } from './preview-draws.js';
import { MOST_PREVIEW_VOICES, previewVoiceBudget, varispeedTaps } from './voice-budget.js';

let dsp: CanonicalDsp;

beforeAll(async () => {
  dsp = expectSuccess(wasmDsp(await dspModuleExports()));
});

/**
 * A resampler run as a varispeed of `numerator` runs (`varispeedSource` of the
 * engine): its steps given as rates eight times them, the least the resampler
 * takes, which designs the same filter.
 */
function varispeed(numerator: number, grade: ResamplingGrade, channels = 2) {
  return expectSuccess(
    dsp.createResampler({
      from: expectSuccess(sampleRate(numerator * 8)),
      to: expectSuccess(sampleRate(VARISPEED_DENOMINATOR * 8)),
      channels,
      quality: resamplingQualityOf(grade),
    }),
  );
}

function pitched(cents: number): VoiceVariation {
  return { ...DEFAULT_VOICE_VARIATION, pitchCents: { min: -cents, max: cents } };
}

describe("a varispeed's taps", () => {
  it.each([ResamplingGrade.Draft, ResamplingGrade.High])(
    'are no more than the bound at %s, nor far below it',
    (grade) => {
      for (const numerator of [1_024, 3_001, 4_095, 4_097, 5_000, 8_191, 12_345, 16_383, 16_384]) {
        const resampler = varispeed(numerator, grade, 1);
        const taps = 2 * resampler.lookahead + 1;
        resampler.release();
        expect(taps, String(numerator)).toBeLessThanOrEqual(varispeedTaps(grade, numerator));
        expect(taps, String(numerator)).toBeGreaterThan(varispeedTaps(grade, numerator) - 8);
      }
      expect(varispeedTaps(grade, 16_384)).toBe(VARISPEED_MOST_TAPS[grade] + 2);
    },
  );
});

describe('the voice budget', () => {
  it('is every voice a preview can sound where no voice varies its pitch', () => {
    expect(previewVoiceBudget(ResamplingGrade.High, [DEFAULT_VOICE_VARIATION])).toBe(
      MOST_PREVIEW_VOICES,
    );
    expect(previewVoiceBudget(ResamplingGrade.High, [])).toBe(MOST_PREVIEW_VOICES);
  });

  it('falls as the costliest pitch any member may draw rises', () => {
    expect(previewVoiceBudget(ResamplingGrade.Draft, [pitched(5)])).toBe(26);
    expect(previewVoiceBudget(ResamplingGrade.Draft, [pitched(5), pitched(2_400)])).toBe(8);
    expect(previewVoiceBudget(ResamplingGrade.High, [pitched(5)])).toBe(7);
    expect(previewVoiceBudget(ResamplingGrade.High, [pitched(1_200)])).toBe(4);
    expect(previewVoiceBudget(ResamplingGrade.High, [pitched(2_400)])).toBe(2);
    // Only downwards: as dear as unison.
    const down = { ...DEFAULT_VOICE_VARIATION, pitchCents: { min: -2_400, max: -100 } };
    expect(previewVoiceBudget(ResamplingGrade.High, [down])).toBe(7);
  });

  it.each([
    [ResamplingGrade.Draft, 5],
    [ResamplingGrade.High, 5],
    [ResamplingGrade.High, 2_400],
  ] as const)(
    'plays its voices at %s, ±%i cents at the dearest, a second of stereo in half a second',
    { timeout: 60_000 },
    (grade, cents) => {
      const budget = previewVoiceBudget(grade, [pitched(cents)]);
      const numerator = pitchNumerator(cents);
      const voices = Array.from({ length: budget }, () => varispeed(numerator, grade));
      const input = [512, 512].map(() =>
        Float32Array.from({ length: 512 }, (_, frame) => Math.sin(frame / 9)),
      );
      const output = [new Float32Array(512), new Float32Array(512)];
      const run = (seconds: number): number => {
        const started = performance.now();
        for (const voice of voices) {
          for (let made = 0; made < 48_000 * seconds;) {
            voice.push(input);
            for (let got = voice.pull(output); got > 0; got = voice.pull(output)) made += got;
          }
        }
        return performance.now() - started;
      };
      // The first second fills each table, as a voice's first second does once.
      run(1);
      const elapsed = run(1);
      for (const voice of voices) voice.release();
      expect(elapsed).toBeLessThan(500);
    },
  );
});
