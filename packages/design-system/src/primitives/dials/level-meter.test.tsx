import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import { MotionLevel } from '../../tokens/preferences.js';
import { heldClock, renderThemed, type HeldClock } from '../../testing/dial-testing.js';
import { LevelMeter, type MeterScale } from './level-meter.js';

/**
 * The level meter applies its ballistics to the readings it is given, frame by
 * frame on the clock it takes, and writes where the level and the peak stand
 * onto each channel's bar; a screen reader hears the reading as reported.
 */

/** A scale even in decibels from -60 to 0, so a position is easy to read back. */
const SCALE: MeterScale = {
  floor: -60,
  positionOf: (decibels) => (decibels + 60) / 60,
  marks: [
    { decibels: -60, label: '−60' },
    { decibels: 0, label: '0' },
  ],
};

/** The linear peak of a level in decibels of full scale. */
const gain = (decibels: number): number => 10 ** (decibels / 20);

function meter(peak: number, held: HeldClock) {
  return (
    <LevelMeter
      label="Levels at the output"
      channels={[{ name: 'Left peak', letter: 'L', peak }]}
      scale={SCALE}
      describePeak={(one) => `${one.toFixed(2)} of full scale`}
      clock={held.clock}
    />
  );
}

/** Where the bar's level and peak stand, as the meter last drew them. */
function drawn(): { readonly level: number; readonly peak: number } {
  const bar = screen.getByRole('meter', { name: 'Left peak' });
  return {
    level: Number(bar.style.getPropertyValue('--ag-meter-level')),
    peak: Number(bar.style.getPropertyValue('--ag-meter-peak')),
  };
}

function clipLamp(): Element {
  const lamp = document.querySelector('.ag-level-meter-clip');
  if (lamp === null) throw new Error('The meter drew no clip lamp.');
  return lamp;
}

describe('LevelMeter', () => {
  it('draws a new reading before any frame passes', () => {
    const held = heldClock();
    renderThemed(meter(gain(-6), held));

    expect(drawn().level).toBeCloseTo(54 / 60, 6);
  });

  it('falls back at the fall rate, holding its peak, as frames pass', () => {
    const held = heldClock();
    const { rerender } = renderThemed(meter(gain(-6), held));
    rerender(meter(gain(-40), held));

    held.advance(500);

    // 20 dB a second for half a second: from -6 to -16; the peak held at -6.
    expect(drawn().level).toBeCloseTo(44 / 60, 6);
    expect(drawn().peak).toBeCloseTo(54 / 60, 6);
  });

  it('falls at the same rate at every motion level', () => {
    const held = heldClock();
    const { rerender } = renderThemed(meter(gain(-6), held), MotionLevel.Minimal);
    rerender(meter(gain(-40), held));

    held.advance(500);

    expect(drawn().level).toBeCloseTo(44 / 60, 6);
  });

  it('asks for no frames once what it shows stands still', () => {
    const held = heldClock();
    const { rerender } = renderThemed(meter(gain(-6), held));

    expect(held.waiting()).toBe(0);

    rerender(meter(gain(-40), held));
    expect(held.waiting()).toBe(1);

    held.advance(10_000);
    held.advance(16);
    expect(held.waiting()).toBe(0);
  });

  it('lights its clip lamp on an over and puts it out after the hold', () => {
    const held = heldClock();
    const { rerender } = renderThemed(meter(1.5, held));

    expect(clipLamp()).toHaveAttribute('data-ag-lit');

    rerender(meter(gain(-20), held));
    held.advance(1400);
    expect(clipLamp()).toHaveAttribute('data-ag-lit');

    held.advance(200);
    expect(clipLamp()).not.toHaveAttribute('data-ag-lit');
  });

  it('tells a screen reader each channel and the reading as reported', () => {
    const held = heldClock();
    renderThemed(meter(0.5, held));

    expect(screen.getByRole('group', { name: 'Levels at the output' })).toBeInTheDocument();
    const bar = screen.getByRole('meter', { name: 'Left peak' });
    expect(bar).toHaveAttribute('aria-valuenow', '0.5');
    expect(bar).toHaveAttribute('aria-valuetext', '0.50 of full scale');
  });
});
