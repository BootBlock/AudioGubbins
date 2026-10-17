import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderThemed } from '../../testing/render-themed.js';
import { RecordButton } from './record-button.js';

describe('RecordButton', () => {
  it('is a button named by its label, pressed while recording', () => {
    const { rerender } = renderThemed(
      <RecordButton label="Record" recording={false} onPress={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Record' })).toHaveAttribute('aria-pressed', 'false');

    rerender(<RecordButton label="Record" recording onPress={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Record' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('lights its lamp while recording and not otherwise', () => {
    const { rerender } = renderThemed(
      <RecordButton label="Record" recording={false} onPress={vi.fn()} />,
    );
    const drawing = (): SVGElement | null =>
      screen.getByRole('button').querySelector('svg.ag-record-drawing');
    expect(drawing()).not.toHaveAttribute('data-ag-lit');

    rerender(<RecordButton label="Record" recording onPress={vi.fn()} />);
    expect(drawing()).toHaveAttribute('data-ag-lit');
  });

  it('runs when pressed', async () => {
    const onPress = vi.fn();
    renderThemed(<RecordButton label="Record" recording={false} onPress={onPress} />);

    await userEvent.click(screen.getByRole('button', { name: 'Record' }));

    expect(onPress).toHaveBeenCalledOnce();
  });

  it('runs nothing while unavailable, and says why', async () => {
    const onPress = vi.fn();
    renderThemed(
      <RecordButton
        label="Record"
        recording={false}
        onPress={onPress}
        unavailableReason="Choose an input to record from."
      />,
    );

    const button = screen.getByRole('button', { name: 'Record' });
    await userEvent.click(button);

    expect(onPress).not.toHaveBeenCalled();
    expect(button).toHaveAccessibleDescription('Choose an input to record from.');
  });
});
