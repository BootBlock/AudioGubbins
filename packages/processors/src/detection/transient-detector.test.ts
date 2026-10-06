import { describe, expect, it } from 'vitest';

import { MeasureUnit } from '@audiogubbins/domain';

import { partials } from '../testing/repair-signals.js';
import { detect, withOnsets } from '../testing/detection-signals.js';
import { TEST_RATE } from '../testing/processor-run.js';
import { TRANSIENT_DETECTOR } from './transient-detector.js';

const LENGTH = 4 * TEST_RATE;
const programme = partials(LENGTH);
/** The frames read at 48 kHz: 2048 samples, 512 apart. */
const SIZE = 2_048;

/** The onsets found in `channels`: each range's start and channels. */
function onsetsIn(...channels: Float32Array[]) {
  return detect(TRANSIENT_DETECTOR, channels).map(({ range, channels: on }) => ({
    start: range.start,
    end: range.end,
    channels: on,
  }));
}

describe('the transient detector', () => {
  it('finds each onset in the frame that holds it, measured past its threshold', () => {
    const onsets = [20_000, 50_000, 100_000, 150_007];
    const found = detect(TRANSIENT_DETECTOR, [withOnsets(programme, onsets, 0.5)]);
    expect(found).toHaveLength(onsets.length);
    for (const [index, onset] of onsets.entries()) {
      const finding = found[index];
      expect(finding?.range.start).toBeLessThanOrEqual(onset);
      expect(finding?.range.end).toBeGreaterThan(onset);
      expect((finding?.range.end ?? 0) - (finding?.range.start ?? 0)).toBe(SIZE);
      expect(finding?.channels).toEqual([0]);
      expect(finding?.measure.unit).toBe(MeasureUnit.Decibels);
      expect(finding?.measure.value).toBeGreaterThan(20);
      expect(finding?.treatment.kind).toBe('none');
    }
  });

  it('makes one finding of onsets closer than 50 ms, and two of onsets further apart', () => {
    expect(onsetsIn(withOnsets(programme, [50_000, 51_000], 0.5))).toHaveLength(1);
    expect(onsetsIn(withOnsets(programme, [50_000, 53_000], 0.5))).toHaveLength(2);
  });

  it('makes one finding of an onset on several channels, with the channels it is on', () => {
    const found = onsetsIn(
      withOnsets(programme, [20_000, 100_000], 0.5),
      programme,
      withOnsets(programme, [20_300, 150_000], 0.5),
    );
    expect(found.map(({ channels }) => channels)).toEqual([[0, 2], [0], [2]]);
  });

  it('finds nothing in held notes, in silence, or in an attack too quiet to hear', () => {
    expect(onsetsIn(programme)).toEqual([]);
    expect(onsetsIn(new Float32Array(LENGTH))).toEqual([]);
    // A burst at −80 dBFS over silence: under the threshold's floor.
    expect(onsetsIn(withOnsets(new Float32Array(LENGTH), [50_000], 0.0001))).toEqual([]);
    expect(onsetsIn(withOnsets(new Float32Array(LENGTH), [50_000], 0.01))).toHaveLength(1);
  });
});
