import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ValueSlider } from '../value-slider.js';
import { renderThemed } from '../../testing/dial-testing.js';

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
