import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ThresholdMeter } from './threshold-meter.js';

/** The places the stylesheet draws the zones and the tick at. */
function places(meter: HTMLElement): readonly string[] {
  return ['--ag-threshold-pass', '--ag-threshold-warn', '--ag-threshold-value'].map((name) =>
    meter.style.getPropertyValue(name),
  );
}

describe('ThresholdMeter', () => {
  it('says the reading and what it is held to, since its zones are colour alone', () => {
    render(
      <ThresholdMeter
        label="Click at the seam"
        value={0.82}
        passUntil={0.3}
        warnUntil={0.6}
        valueText="11.4 deviations; passes at 4 or less, warns to 8"
      />,
    );

    const meter = screen.getByRole('meter', { name: 'Click at the seam' });
    expect(meter).toHaveAttribute('aria-valuenow', '0.82');
    expect(meter).toHaveAttribute(
      'aria-valuetext',
      '11.4 deviations; passes at 4 or less, warns to 8',
    );
    expect(places(meter)).toEqual(['0.3', '0.6', '0.82']);
  });

  it('holds a reading past either end to the bar, and never draws the fail zone over the pass zone', () => {
    // A discontinuity of 40 deviations on a scale that ends at 12 drew its
    // tick off the bar's end, where a reader saw no reading at all.
    render(
      <ThresholdMeter
        label="Click at the seam"
        value={3.2}
        passUntil={0.5}
        warnUntil={0.2}
        valueText="40 deviations"
      />,
    );

    const meter = screen.getByRole('meter', { name: 'Click at the seam' });
    expect(meter).toHaveAttribute('aria-valuenow', '1');
    expect(places(meter)).toEqual(['0.5', '0.5', '1']);
  });
});
