import { describe, expect, it } from 'vitest';

import { MeasureUnit } from '@audiogubbins/domain';

import { clipped, detect, hiss, tone } from '../testing/detection-signals.js';
import { TEST_RATE } from '../testing/processor-run.js';
import { CLIPPING_DETECTOR } from './clipping-detector.js';

const LENGTH = TEST_RATE;

/** The frames a sine of `hertz`, from phase zero, crests at, up to `length`. */
function crests(hertz: number, length: number): number[] {
  const period = TEST_RATE / hertz;
  const out: number[] = [];
  for (let crest = period / 4; crest < length; crest += period / 2) out.push(crest);
  return out;
}

describe('the clipping detector', () => {
  it('finds each flattened crest of a clipped sine, its frames and its magnitude', () => {
    // A full-scale 440 Hz sine held to half of full scale: each half cycle is
    // flat where |sin| ≥ 1/2, a third of a period, 36.4 frames.
    const found = detect(CLIPPING_DETECTOR, [clipped(tone(LENGTH, 440, 0), 0.5)]);
    const expected = crests(440, LENGTH - 20);
    expect(found).toHaveLength(expected.length);
    for (const [index, crest] of expected.entries()) {
      const finding = found[index];
      const start = finding?.range.start ?? 0;
      const end = finding?.range.end ?? 0;
      expect(start).toBeLessThanOrEqual(crest);
      expect(end).toBeGreaterThan(crest);
      expect(Math.abs(end - start - TEST_RATE / 440 / 3)).toBeLessThanOrEqual(1);
      expect(finding?.channels).toEqual([0]);
      expect(finding?.measure).toEqual({
        value: expect.closeTo(-6.0206, 3) as number,
        unit: MeasureUnit.Dbfs,
      });
    }
  });

  it('makes one finding of a run cut at the edge of the extractor’s block', () => {
    // A 20 Hz sine clipped at 0.9 is flat for 7 ms around each crest; one
    // is moved to frame 8 192, where the extractor's first block ends.
    const phase = 0.25 - (20 * 8_192) / TEST_RATE;
    const found = detect(CLIPPING_DETECTOR, [clipped(tone(LENGTH, 20, 0, phase), 0.9)]);
    const across = found.filter(({ range }) => range.start < 8_192 && range.end > 8_192);
    expect(across).toHaveLength(1);
    expect(found.filter(({ range }) => range.end === 8_192 || range.start === 8_192)).toEqual([]);
  });

  it('makes one finding of runs on several channels at one place, with every channel', () => {
    const fault = clipped(tone(LENGTH, 440, 0), 0.5);
    const found = detect(CLIPPING_DETECTOR, [fault, tone(LENGTH, 440, -1), fault]);
    expect(found).toHaveLength(crests(440, LENGTH - 20).length);
    for (const finding of found) expect(finding.channels).toEqual([0, 2]);
  });

  it('says it cannot treat clipping, and what a person can do instead', () => {
    const [finding] = detect(CLIPPING_DETECTOR, [clipped(tone(LENGTH, 440, 0), 0.5)]);
    expect(finding?.treatment.kind).toBe('none');
    if (finding?.treatment.kind === 'none') {
      expect(finding.treatment.reason).toContain('no declipper');
      expect(finding.treatment.reason).toContain('lower the level');
    }
  });

  it('finds nothing at a smooth crest, however slow, or in a passage too quiet to clip', () => {
    expect(detect(CLIPPING_DETECTOR, [tone(LENGTH, 440, -1)])).toEqual([]);
    // A full-scale 20 Hz sine stays within 2⁻¹⁶ of its crest for 4 frames.
    expect(detect(CLIPPING_DETECTOR, [tone(LENGTH, 20, 0)])).toEqual([]);
    // Noise at −100 dBFS: every sample is within 2⁻¹⁶ of the loudest.
    expect(detect(CLIPPING_DETECTOR, [hiss(LENGTH, -100)])).toEqual([]);
    expect(detect(CLIPPING_DETECTOR, [new Float32Array(LENGTH)])).toEqual([]);
  });
});
