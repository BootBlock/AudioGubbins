import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ValueSlider } from '../value-slider.js';
import { Fader } from './fader.js';
import { Knob } from './knob.js';
import { renderThemed } from '../../testing/render-themed.js';

/**
 * An unavailable slider keeps its focus, so its reason is reached by the
 * keyboard (ADR-0013), and refuses every change; a disabled one, given no
 * reason, leaves the focus order as it always has.
 */

describe('ValueSlider, unavailable', () => {
  it('keeps its focus and its reason, and changes nothing', async () => {
    const onValueChange = vi.fn();
    const onValueCommit = vi.fn();
    renderThemed(
      <ValueSlider
        label="Mix"
        value={50}
        minimum={0}
        maximum={100}
        step={1}
        onValueChange={onValueChange}
        onValueCommit={onValueCommit}
        describeValue={(value) => `${String(value)} per cent`}
        unavailableReason="Turn the processor on first"
      />,
    );

    await userEvent.tab();
    const thumb = screen.getByRole('slider', { name: 'Mix' });
    expect(thumb).toHaveFocus();
    expect(thumb).toHaveAttribute('aria-disabled', 'true');
    expect(thumb).toHaveAccessibleDescription('Turn the processor on first');

    await userEvent.keyboard('{ArrowRight}{End}');
    expect(onValueChange).not.toHaveBeenCalled();
    expect(onValueCommit).not.toHaveBeenCalled();
  });

  it('leaves the focus order when disabled without a reason', async () => {
    renderThemed(
      <ValueSlider
        label="Mix"
        value={50}
        minimum={0}
        maximum={100}
        step={1}
        onValueChange={vi.fn()}
        describeValue={String}
        disabled
      />,
    );

    await userEvent.tab();

    expect(screen.getByRole('slider', { name: 'Mix' })).not.toHaveFocus();
  });
});

describe('a dial that becomes unavailable while it has the focus', () => {
  // A dial is often made unavailable by the very change its person just made
  // elsewhere, with the keyboard still on it. Were the reason's hint a wrapper
  // grown only once there is a reason, the control would be mounted again and
  // the focus would fall to the page, taking the reason with it.
  const dial = { label: 'Mix', value: 50, minimum: 0, maximum: 100, step: 1 } as const;
  const shared = { onValueChange: vi.fn(), describeValue: String };
  const REASON = 'Turn the processor on first';
  const reasonOf = (reason?: string) => (reason === undefined ? {} : { unavailableReason: reason });

  it.each([
    ['slider', (reason?: string) => <ValueSlider {...dial} {...shared} {...reasonOf(reason)} />],
    ['knob', (reason?: string) => <Knob {...dial} {...shared} {...reasonOf(reason)} />],
    ['fader', (reason?: string) => <Fader {...dial} {...shared} {...reasonOf(reason)} />],
  ] as const)('keeps the focus on the %s and says why', async (_, draw) => {
    const { rerender } = renderThemed(draw());
    await userEvent.tab();
    const control = screen.getByRole('slider', { name: 'Mix' });
    expect(control).toHaveFocus();

    rerender(draw(REASON));

    const unavailable = screen.getByRole('slider', { name: 'Mix' });
    expect(unavailable).toBe(control);
    expect(unavailable).toHaveFocus();
    expect(unavailable).toHaveAccessibleDescription(REASON);
  });
});
