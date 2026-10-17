import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderThemed } from '../testing/render-themed.js';
import { TabSet } from './controls.js';
import { ValueSlider } from './value-slider.js';

describe('ValueSlider', () => {
  it('announces its value in the unit the user is working in', () => {
    // A bare number is useless on a logarithmic control: the user is thinking
    // in decibels, not in the position of a thumb.
    renderThemed(
      <ValueSlider
        label="Gain"
        value={-6}
        minimum={-60}
        maximum={12}
        step={0.1}
        onValueChange={vi.fn()}
        describeValue={(value) => `${value.toFixed(1)} decibels`}
        displayValue="-6.0 dB"
      />,
    );

    expect(screen.getByRole('slider', { name: 'Gain' })).toHaveAttribute(
      'aria-valuetext',
      '-6.0 decibels',
    );
  });

  it('changes by one step from the keyboard', async () => {
    const onValueChange = vi.fn();
    renderThemed(
      <ValueSlider
        label="Gain"
        value={0}
        minimum={-60}
        maximum={12}
        step={1}
        onValueChange={onValueChange}
        describeValue={(value) => `${String(value)} decibels`}
      />,
    );

    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}');

    expect(onValueChange).toHaveBeenCalledWith(1);
  });

  it('moves along a scale, a keyboard step a step of the scale, settling at each', async () => {
    // Three decades from 10 to 10,000 in thirty steps: ten to a decade.
    const decades = {
      steps: 30,
      positionOf: (value: number) => Math.log10(value / 10) / 3,
      valueAt: (position: number) => 10 * 1000 ** position,
    };
    const onValueChange = vi.fn();
    const onValueCommit = vi.fn();
    renderThemed(
      <ValueSlider
        label="Frequency"
        value={100}
        minimum={10}
        maximum={10_000}
        scale={decades}
        onValueChange={onValueChange}
        onValueCommit={onValueCommit}
        describeValue={(value) => `${value.toFixed(0)} hertz`}
      />,
    );

    // A tenth of a decade up from 100 Hz.
    const slider = screen.getByRole('slider', { name: 'Frequency' });
    expect(slider).toHaveAttribute('aria-valuenow', '10');
    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}');

    expect(onValueChange).toHaveBeenCalledOnce();
    expect(onValueChange.mock.calls[0]?.[0]).toBeCloseTo(125.89, 2);
    expect(onValueCommit).toHaveBeenCalledOnce();
    expect(onValueCommit.mock.calls[0]?.[0]).toBeCloseTo(125.89, 2);
  });

  it('reports its range, so a screen reader can say where the value sits', () => {
    renderThemed(
      <ValueSlider
        label="Gain"
        value={0}
        minimum={-60}
        maximum={12}
        step={1}
        onValueChange={vi.fn()}
        describeValue={String}
      />,
    );

    const slider = screen.getByRole('slider', { name: 'Gain' });
    expect(slider).toHaveAttribute('aria-valuemin', '-60');
    expect(slider).toHaveAttribute('aria-valuemax', '12');
  });
});

describe('TabSet', () => {
  it('names its tab list and shows only the selected panel', () => {
    renderThemed(
      <TabSet
        label="Settings sections"
        value="appearance"
        onValueChange={vi.fn()}
        tabs={[
          { value: 'appearance', label: 'Appearance', content: <p>Appearance settings</p> },
          { value: 'shortcuts', label: 'Shortcuts', content: <p>Shortcut settings</p> },
        ]}
      />,
    );

    expect(screen.getByRole('tablist', { name: 'Settings sections' })).toBeInTheDocument();
    expect(screen.getByText('Appearance settings')).toBeInTheDocument();
    expect(screen.queryByText('Shortcut settings')).not.toBeInTheDocument();
  });

  it('moves between tabs with the arrow keys', async () => {
    const onValueChange = vi.fn();
    renderThemed(
      <TabSet
        label="Settings sections"
        value="appearance"
        onValueChange={onValueChange}
        tabs={[
          { value: 'appearance', label: 'Appearance', content: <p>A</p> },
          { value: 'shortcuts', label: 'Shortcuts', content: <p>B</p> },
        ]}
      />,
    );

    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}');

    expect(onValueChange).toHaveBeenCalledWith('shortcuts');
  });
});
