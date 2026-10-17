import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderThemed } from '../../testing/render-themed.js';
import { sampledBoxOf } from '../../testing/shape-sampler.js';
import { PowerSwitch } from './power-switch.js';
import { POWER_GRID_CENTRE } from './power-switch-drawing.js';

/** The switch's drawn size in pixels, on its 32-unit grid (design language, section 10). */
const PIXELS_PER_UNIT = 26 / 32;

/** The design language's tolerance for the power glyph's centring. */
const TOLERANCE_PIXELS = 0.02;

describe('PowerSwitch', () => {
  it('is a switch named by what it powers, saying whether it is on', () => {
    renderThemed(<PowerSwitch label="Equaliser" checked onCheckedChange={vi.fn()} />);
    expect(screen.getByRole('switch', { name: 'Equaliser' })).toBeChecked();
  });

  it('turns over from the keyboard', async () => {
    const onCheckedChange = vi.fn();
    renderThemed(
      <PowerSwitch label="Equaliser" checked={false} onCheckedChange={onCheckedChange} />,
    );

    await userEvent.tab();
    await userEvent.keyboard('{Enter}');

    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('lights its LED while on and not while off', () => {
    const { rerender } = renderThemed(
      <PowerSwitch label="Equaliser" checked={false} onCheckedChange={vi.fn()} />,
    );
    const drawing = (): SVGElement | null =>
      screen.getByRole('switch').querySelector('svg.ag-power-drawing');
    expect(drawing()).not.toHaveAttribute('data-ag-lit');

    rerender(<PowerSwitch label="Equaliser" checked onCheckedChange={vi.fn()} />);
    expect(drawing()).toHaveAttribute('data-ag-lit');
  });

  it('centres the ink of its glyph in the button to within 0.02 px', () => {
    // Read back from the DOM: the shapes drawn and the placement they are
    // drawn at, with the ink's box found by sampling the shapes, not by the
    // glyph's own measurement.
    renderThemed(<PowerSwitch label="Equaliser" checked onCheckedChange={vi.fn()} />);
    const glyph = document.querySelector('.ag-power-glyph');
    const placement = /^translate\((-?[\d.e-]+) (-?[\d.e-]+)\) scale\(([\d.e-]+)\)$/.exec(
      glyph?.getAttribute('transform') ?? '',
    );
    expect(placement).not.toBeNull();
    const shapes = glyph?.querySelector('.ag-power-led-core')?.children ?? [];
    expect(shapes.length).toBeGreaterThan(0);

    const box = sampledBoxOf(shapes);
    const [x, y, scale] = [placement?.[1], placement?.[2], placement?.[3]].map(Number);
    const centre = (low: number, high: number, shift: number | undefined): number =>
      (shift ?? Number.NaN) + (scale ?? Number.NaN) * ((low + high) / 2);

    const missX = (centre(box.left, box.right, x) - POWER_GRID_CENTRE) * PIXELS_PER_UNIT;
    const missY = (centre(box.top, box.bottom, y) - POWER_GRID_CENTRE) * PIXELS_PER_UNIT;
    expect(Math.abs(missX)).toBeLessThanOrEqual(TOLERANCE_PIXELS);
    expect(Math.abs(missY)).toBeLessThanOrEqual(TOLERANCE_PIXELS);
  });

  it('keeps its focus while unavailable and does not turn over', async () => {
    const onCheckedChange = vi.fn();
    renderThemed(
      <PowerSwitch
        label="Equaliser"
        checked
        onCheckedChange={onCheckedChange}
        unavailableReason="The chain is being rendered."
      />,
    );

    await userEvent.tab();
    const control = screen.getByRole('switch', { name: 'Equaliser' });
    expect(control).toHaveFocus();
    await userEvent.keyboard('{Enter}');

    expect(onCheckedChange).not.toHaveBeenCalled();
    expect(control).toHaveAccessibleDescription('The chain is being rendered.');
  });
});
