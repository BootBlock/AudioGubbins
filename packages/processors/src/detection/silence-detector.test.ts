import { describe, expect, it } from 'vitest';

import { FindingKind, MeasureUnit, type DetectorFinding } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import { detect, hiss, tone } from '../testing/detection-signals.js';
import { TEST_RATE } from '../testing/processor-run.js';
import { settledValues } from './detector-values.js';
import { SILENCE_DETECTOR } from './silence-detector.js';

/** Frames of `seconds` at the test rate. */
function at(seconds: number): number {
  return Math.round(seconds * TEST_RATE);
}

/**
 * A signal of `seconds`, a −20 dBFS tone wherever `sound` says, and a hiss at
 * −70 dBFS, under the detector's −60 dBFS, everywhere else.
 */
function programme(seconds: number, sound: readonly (readonly [number, number])[]): Float32Array {
  const quiet = hiss(at(seconds), -70);
  // From a crest, so the first and last frames of each stretch of tone are loud.
  const loud = tone(at(seconds), 440, -20, 0.25);
  for (const [from, to] of sound) quiet.set(loud.subarray(at(from), at(to)), at(from));
  return quiet;
}

/** Each finding's range, in frames. */
function spans(found: readonly DetectorFinding[]): readonly (readonly [number, number])[] {
  return found.map(({ range }) => [range.start, range.end]);
}

describe('the silence detector', () => {
  it('takes the quiet at either edge out whole, and shortens a long pause within to a quarter second', async () => {
    const found = await detect(SILENCE_DETECTOR, [
      programme(4, [
        [0.3, 1.5],
        [2.5, 3.6],
      ]),
    ]);
    expect(found.every((finding) => finding.kind === FindingKind.Silence)).toBe(true);
    expect(found.every((finding) => finding.treatment.kind === 'removal')).toBe(true);
    // The tone's own zero crossings are quiet for a frame or two, which is no
    // silence: only the stretches of hiss are found.
    expect(spans(found)).toEqual([
      [0, at(0.3)],
      [at(1.5) + at(0.125), at(2.5) - at(0.125)],
      [at(3.6), at(4)],
    ]);
  });

  it('keeps a pause under half a second, and an edge under 10 ms', async () => {
    const found = await detect(SILENCE_DETECTOR, [
      programme(2, [
        [0.005, 0.8],
        [1.2, 1.995],
      ]),
    ]);
    expect(found).toEqual([]);
  });

  it('weighs a frame quiet only where every channel is', async () => {
    const quiet = programme(2, [[0.5, 2]]);
    const found = await detect(SILENCE_DETECTOR, [quiet, programme(2, [[0.2, 2]])]);
    expect(spans(found)).toEqual([[0, at(0.2)]]);
    expect(found[0]?.channels).toEqual([0, 1]);
  });

  it('joins a quiet stretch across the extractor’s blocks, and measures its loudest sample', async () => {
    // The pause runs over the blocks of 8 192 frames that end at 16 384 and 24 576.
    const found = await detect(
      SILENCE_DETECTOR,
      [
        programme(1, [
          [0, 0.1],
          [0.6, 1],
        ]),
      ],
      1_000,
    );
    expect(spans(found)).toEqual([[at(0.1) + at(0.125), at(0.6) - at(0.125)]]);
    const level = found[0]?.measure;
    expect(level?.unit).toBe(MeasureUnit.Linear);
    expect(level?.value).toBeGreaterThan(0);
    expect(level?.value).toBeLessThan(0.001);
  });

  it('finds digital silence, measured as nothing, and treats none where it is all there is', async () => {
    const silent = await detect(SILENCE_DETECTOR, [new Float32Array(at(1))]);
    expect(spans(silent)).toEqual([[0, at(1)]]);
    expect(silent[0]?.measure.value).toBe(0);
    expect(silent[0]?.treatment.kind).toBe('none');
  });
});

describe('the silence detector, as a person sets it', () => {
  it('hears a noisy room as silence once its threshold is above the noise', async () => {
    // Hiss at −50 dBFS is sound at the default −60, and silence at −40.
    const noisy = hiss(at(2), -50);
    noisy.set(tone(at(2), 440, -20, 0.25).subarray(at(0.5), at(1.5)), at(0.5));
    expect(await detect(SILENCE_DETECTOR, [noisy])).toEqual([]);
    const found = await detect(SILENCE_DETECTOR, [noisy], 4_096, undefined, { threshold: -40 });
    expect(spans(found)).toEqual([
      [0, at(0.5)],
      [at(1.5), at(2)],
    ]);
  });

  it('takes the shortest edge and pause and the pause kept as set', async () => {
    const audio = [
      programme(4, [
        [0.3, 1.5],
        [2.5, 3.6],
      ]),
    ];
    const found = await detect(SILENCE_DETECTOR, audio, 4_096, undefined, {
      'shortest-edge': 0.35,
      'shortest-pause': 0.9,
      'pause-kept': 0.5,
    });
    // The 0.3 s lead is under the shortest edge now; the pause keeps half a second.
    expect(spans(found)).toEqual([
      [at(1.5) + at(0.25), at(2.5) - at(0.25)],
      [at(3.6), at(4)],
    ]);
    const longer = await detect(SILENCE_DETECTOR, audio, 4_096, undefined, {
      'shortest-pause': 1.5,
    });
    expect(spans(longer)).toEqual([
      [0, at(0.3)],
      [at(3.6), at(4)],
    ]);
  });

  it('refuses a pause kept as long as the shortest pause, which would shorten none', () => {
    for (const kept of [0.5, 0.6]) {
      expect(expectFailureCode(settledValues(SILENCE_DETECTOR, { 'pause-kept': kept }))).toBe(
        'detection.parameters-inconsistent',
      );
    }
    expectSuccess(settledValues(SILENCE_DETECTOR, { 'pause-kept': 0.5, 'shortest-pause': 0.51 }));
  });
});
