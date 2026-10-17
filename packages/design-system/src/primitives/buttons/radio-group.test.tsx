import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderThemed } from '../../testing/render-themed.js';
import { RadioGroup, type RadioOption } from './radio-group.js';

const TAKES: readonly RadioOption[] = [
  { value: 'one', label: 'Take 1', description: 'Recorded at 14:02' },
  { value: 'two', label: 'Take 2', description: 'Recorded at 14:05' },
];

/** Whether the lamp of the choice named `name` is drawn lit. */
function lampLit(name: string): boolean {
  return screen.getByRole('radio', { name }).querySelector('svg[data-ag-lit]') !== null;
}

describe('RadioGroup', () => {
  it('is a radio group named by its heading, each choice named by its label alone', () => {
    renderThemed(
      <RadioGroup label="Take heard" value="one" options={TAKES} onValueChange={vi.fn()} />,
    );

    expect(screen.getByRole('radiogroup', { name: 'Take heard' })).toBeInTheDocument();
    const first = screen.getByRole('radio', { name: 'Take 1' });
    expect(first).toBeChecked();
    expect(first).toHaveAccessibleDescription('Recorded at 14:02');
  });

  it('lights the lamp of the chosen choice alone, and moves the light with the choice', () => {
    const { rerender } = renderThemed(
      <RadioGroup label="Take heard" value="one" options={TAKES} onValueChange={vi.fn()} />,
    );
    expect([lampLit('Take 1'), lampLit('Take 2')]).toEqual([true, false]);

    rerender(<RadioGroup label="Take heard" value="two" options={TAKES} onValueChange={vi.fn()} />);
    expect([lampLit('Take 1'), lampLit('Take 2')]).toEqual([false, true]);
  });

  it('chooses the next choice with an arrow key', async () => {
    const onValueChange = vi.fn();
    renderThemed(
      <RadioGroup label="Take heard" value="one" options={TAKES} onValueChange={onValueChange} />,
    );

    await userEvent.tab();
    // Held, as a finger holds a key for longer than the roving focus waits to
    // move: the choice is made as focus arrives while the key is down.
    await userEvent.keyboard('{ArrowDown>}');
    await waitFor(() => {
      expect(onValueChange).toHaveBeenCalledWith('two');
    });
  });

  it('changes nothing while unavailable', async () => {
    const onValueChange = vi.fn();
    renderThemed(
      <RadioGroup
        label="Take heard"
        value="one"
        options={TAKES}
        onValueChange={onValueChange}
        unavailableReason="Stop recording to choose a take."
      />,
    );

    await userEvent.click(screen.getByRole('radio', { name: 'Take 2' }));

    expect(onValueChange).not.toHaveBeenCalled();
    expect(screen.getByRole('radiogroup')).toHaveAccessibleDescription(
      'Stop recording to choose a take.',
    );
  });

  it('gives each lamp its own light, so two on a page do not share one gradient', () => {
    renderThemed(
      <RadioGroup label="Take heard" value="one" options={TAKES} onValueChange={vi.fn()} />,
    );

    const ids = [...document.querySelectorAll('svg.ag-lamp radialGradient')].map(
      (gradient) => gradient.id,
    );
    expect(new Set(ids).size).toBe(ids.length);
    for (const lamp of document.querySelectorAll('svg.ag-lamp')) {
      for (const shape of lamp.querySelectorAll('[fill^="url(#"]')) {
        const target = /^url\(#(.+)\)$/.exec(shape.getAttribute('fill') ?? '')?.[1] ?? '';
        expect(lamp.querySelector(`[id="${target}"]`), target).not.toBeNull();
      }
    }
  });
});
