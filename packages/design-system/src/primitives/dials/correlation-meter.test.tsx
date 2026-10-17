import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import { CorrelationMeter } from './correlation-meter.js';
import { heldClock, renderThemed, type HeldClock } from '../../testing/dial-testing.js';

/**
 * The correlation pointer glides to each reading with the ballistics' time
 * constant, frame by frame on the clock the meter takes.
 */

function meter(correlation: number, held: HeldClock) {
  return (
    <CorrelationMeter
      label="Left and right correlation"
      caption="Corr"
      correlation={correlation}
      displayValue={correlation.toFixed(2)}
      describeCorrelation={(one) => `correlation ${one.toFixed(2)}`}
      clock={held.clock}
    />
  );
}

/** Where the pointer stands along the bar, from 0 at -1 to 1 at +1. */
function pointer(): number {
  const bar = screen.getByRole('meter', { name: 'Left and right correlation' });
  return Number(bar.style.getPropertyValue('--ag-correlation-at'));
}

describe('CorrelationMeter', () => {
  it('appears at its reading', () => {
    const held = heldClock();
    renderThemed(meter(0.5, held));

    expect(pointer()).toBeCloseTo(0.75, 6);
    expect(held.waiting()).toBe(0);
  });

  it('glides to a new reading rather than jumping to it, and comes to rest', () => {
    const held = heldClock();
    const { rerender } = renderThemed(meter(-1, held));
    rerender(meter(1, held));

    expect(pointer()).toBeCloseTo(0, 6);
    held.advance(170);
    expect(pointer()).toBeCloseTo(1 - Math.exp(-1), 6);

    held.advance(5000);
    held.advance(16);
    expect(pointer()).toBeCloseTo(1, 3);
    expect(held.waiting()).toBe(0);
  });

  it('tells a screen reader the reading as reported', () => {
    const held = heldClock();
    renderThemed(meter(-0.25, held));

    const bar = screen.getByRole('meter', { name: 'Left and right correlation' });
    expect(bar).toHaveAttribute('aria-valuenow', '-0.25');
    expect(bar).toHaveAttribute('aria-valuetext', 'correlation -0.25');
  });
});
