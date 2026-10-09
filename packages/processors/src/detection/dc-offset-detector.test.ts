import { describe, expect, it } from 'vitest';

import { MeasureUnit } from '@audiogubbins/domain';

import { partials } from '../testing/repair-signals.js';
import { detect, mixed, tone } from '../testing/detection-signals.js';
import { TEST_RATE } from '../testing/processor-run.js';
import { DC_OFFSET_DETECTOR } from './dc-offset-detector.js';

const LENGTH = 3 * TEST_RATE;
const programme = partials(LENGTH);

/** `length` frames of `value`. */
function offset(value: number, length = LENGTH): Float32Array {
  return new Float32Array(length).fill(value);
}

describe('the DC offset detector', () => {
  it('finds an offset over the whole audio on the channels it is on, measured as their mean', async () => {
    const found = await detect(DC_OFFSET_DETECTOR, [
      mixed(programme, offset(0.05)),
      programme,
      mixed(programme, offset(-0.02)),
    ]);
    expect(found).toHaveLength(1);
    const [finding] = found;
    expect(finding?.range).toEqual({ start: 0, end: LENGTH });
    expect(finding?.channels).toEqual([0, 2]);
    // The programme's partials are whole cycles over a second, so its own
    // mean is all but nothing; the furthest channel's mean is measured.
    expect(finding?.measure.unit).toBe(MeasureUnit.Linear);
    expect(Math.abs((finding?.measure.value ?? 0) - 0.05)).toBeLessThan(1e-4);
    expect(finding?.treatment).toEqual({
      kind: 'steps',
      steps: [{ typeKey: 'dc-offset-removal', values: {} }],
    });
  });

  it('measures a negative offset as negative', async () => {
    const [finding] = await detect(DC_OFFSET_DETECTOR, [mixed(programme, offset(-0.004))]);
    expect(Math.abs((finding?.measure.value ?? 0) + 0.004)).toBeLessThan(1e-4);
  });

  it('finds an offset past a thousandth of full scale, and none short of it', async () => {
    expect(await detect(DC_OFFSET_DETECTOR, [mixed(programme, offset(0.0015))])).toHaveLength(1);
    expect(await detect(DC_OFFSET_DETECTOR, [mixed(programme, offset(0.0005))])).toEqual([]);
  });

  it('finds no offset that does not stay on one side', async () => {
    const turning = offset(0.01);
    turning.fill(-0.01, TEST_RATE);
    expect(await detect(DC_OFFSET_DETECTOR, [mixed(programme, turning)])).toEqual([]);
    const fading = offset(0.01);
    fading.fill(0, 2 * TEST_RATE);
    expect(await detect(DC_OFFSET_DETECTOR, [mixed(programme, fading)])).toEqual([]);
  });

  it('finds nothing in clean programme, a low tone, or audio shorter than a window', async () => {
    expect(await detect(DC_OFFSET_DETECTOR, [programme])).toEqual([]);
    // Half a cycle of a full-scale 20.5 Hz tone left over in each window
    // gives means of ±0.016, one side and then the other.
    expect(await detect(DC_OFFSET_DETECTOR, [tone(LENGTH, 20.5, 0)])).toEqual([]);
    expect(await detect(DC_OFFSET_DETECTOR, [offset(0.1, TEST_RATE - 1)])).toEqual([]);
    expect(await detect(DC_OFFSET_DETECTOR, [offset(0.1, TEST_RATE)])).toHaveLength(1);
  });
});
