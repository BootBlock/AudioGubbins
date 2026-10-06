import { describe, expect, it } from 'vitest';

import { MeasureUnit } from '@audiogubbins/domain';
import { decibelsToGain } from '@audiogubbins/audio-engine';

import { partials } from '../testing/repair-signals.js';
import { detect, hiss, mixed, scaled } from '../testing/detection-signals.js';
import { TEST_RATE } from '../testing/processor-run.js';
import { NOISE_FLOOR_DETECTOR } from './noise-floor-detector.js';

const LENGTH = 4 * TEST_RATE;
const programme = partials(LENGTH);
/** The programme falls silent for a second from here, leaving its noise alone. */
const GAP = [TEST_RATE, 2 * TEST_RATE] as const;
/** The shortest stretch a noise reduction learns its profile from: half a second. */
const STRETCH = 0.5 * TEST_RATE;
const paused = scaled(programme, GAP[0], GAP[1], 0);

describe('the noise floor detector', () => {
  it('finds the stretch of noise alone, at least half a second, measured at the noise’s level', async () => {
    const found = await detect(NOISE_FLOOR_DETECTOR, [mixed(paused, hiss(LENGTH, -50))]);
    expect(found).toHaveLength(1);
    const [finding] = found;
    const start = finding?.range.start ?? 0;
    const end = finding?.range.end ?? 0;
    expect(start).toBeGreaterThanOrEqual(GAP[0]);
    expect(end).toBeLessThanOrEqual(GAP[1]);
    expect(end - start).toBeGreaterThanOrEqual(STRETCH);
    expect(finding?.channels).toEqual([0]);
    expect(finding?.measure.unit).toBe(MeasureUnit.Dbfs);
    // The loudest 50 ms frame of a steady white noise is within a fraction
    // of a decibel of its RMS level.
    expect(Math.abs((finding?.measure.value ?? 0) + 50)).toBeLessThan(0.5);
    expect(finding?.treatment).toEqual({
      kind: 'steps',
      steps: [{ typeKey: 'noise-reduction', values: {}, learnFrom: finding?.range }],
    });
  });

  it('passes over digital silence, which holds no noise to learn from, to the noise', async () => {
    // The audio opens with nearly a second of silence, or of a dither far
    // under any audible noise, each quieter and as steady as the gap.
    const audio = mixed(paused, hiss(LENGTH, -50));
    for (const opening of [0, decibelsToGain(-130)]) {
      const quiet = mixed(
        scaled(audio, 0, 0.9 * TEST_RATE, 0),
        scaled(hiss(LENGTH, 0, 5), 0.9 * TEST_RATE, LENGTH, 0).map((sample) => sample * opening),
      );
      const [finding] = await detect(NOISE_FLOOR_DETECTOR, [quiet]);
      expect(finding?.range.start).toBeGreaterThanOrEqual(GAP[0]);
      expect(finding?.range.end).toBeLessThanOrEqual(GAP[1]);
    }
  });

  it('finds the quietest of two stretches of noise alone', async () => {
    const second = scaled(paused, 3 * TEST_RATE, 3.8 * TEST_RATE, 0);
    const noise = scaled(hiss(LENGTH, -50), 3 * TEST_RATE, 3.8 * TEST_RATE, 0.5);
    const [finding] = await detect(NOISE_FLOOR_DETECTOR, [mixed(second, noise)]);
    expect(finding?.range.start).toBeGreaterThanOrEqual(3 * TEST_RATE);
    expect(Math.abs((finding?.measure.value ?? 0) + 56.02)).toBeLessThan(0.5);
  });

  it('finds nothing where the noise is not heard, or the audio is never noise alone', async () => {
    expect(await detect(NOISE_FLOOR_DETECTOR, [mixed(paused, hiss(LENGTH, -80))])).toEqual([]);
    // A held chord, steady but far louder than noise is.
    expect(await detect(NOISE_FLOOR_DETECTOR, [programme])).toEqual([]);
    // Digital silence holds no noise to learn from.
    expect(await detect(NOISE_FLOOR_DETECTOR, [paused])).toEqual([]);
  });

  it('learns from no stretch that silence or a fade runs through', async () => {
    // The noise falls silent for a fifth of a second in the middle of the
    // gap, leaving two halves too short to learn from; then it fades over the
    // gap, a quarter of its level by half way.
    const noise = hiss(LENGTH, -50);
    const holed = scaled(noise, 1.4 * TEST_RATE, 1.6 * TEST_RATE, 0);
    expect(await detect(NOISE_FLOOR_DETECTOR, [mixed(paused, holed)])).toEqual([]);
    const fading = Float32Array.from(noise, (sample, frame) => {
      const done = (frame - GAP[0]) / TEST_RATE;
      return done < 0 || done >= 1 ? sample : sample * (1 - done) * (1 - done);
    });
    expect(await detect(NOISE_FLOOR_DETECTOR, [mixed(paused, fading)])).toEqual([]);
  });

  it('finds the noise on the channels it is heard on', async () => {
    const found = await detect(NOISE_FLOOR_DETECTOR, [
      mixed(paused, hiss(LENGTH, -85)),
      mixed(paused, hiss(LENGTH, -50, 3)),
    ]);
    expect(found.map(({ channels }) => channels)).toEqual([[1]]);
  });

  it('finds nothing in audio shorter than one stretch', async () => {
    expect(await detect(NOISE_FLOOR_DETECTOR, [hiss(0.45 * TEST_RATE, -40)])).toEqual([]);
    expect(await detect(NOISE_FLOOR_DETECTOR, [hiss(0.55 * TEST_RATE, -40)])).toHaveLength(1);
  });
});
