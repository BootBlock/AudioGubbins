import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderThemed } from '../../testing/render-themed.js';
import { ControlBar, ControlBarItem } from './control-bar.js';
import { TransportButton } from './transport-button.js';

describe('TransportButton', () => {
  it('draws the main button lit as a call to action, and grown while it runs', () => {
    // The approved Transport draws play as the one lit button, larger again
    // while playing; drawn as icon buttons, play and stop were alike.
    const { rerender } = renderThemed(
      <TransportButton icon="play" label="Play" main onClick={vi.fn()} />,
    );
    const play = screen.getByRole('button', { name: 'Play' });
    expect(play).toHaveAttribute('data-ag-transport', 'main');
    expect(play).toHaveAttribute('data-ag-tone', 'primary');
    expect(play).not.toHaveAttribute('data-ag-running');

    rerender(<TransportButton icon="pause" label="Pause" main running onClick={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Pause' })).toHaveAttribute('data-ag-running');
  });

  it('draws an ordinary one round on the quiet fill, never lit', () => {
    renderThemed(<TransportButton icon="stop" label="Stop" onClick={vi.fn()} />);

    const stop = screen.getByRole('button', { name: 'Stop' });
    expect(stop).toHaveAttribute('data-ag-transport', 'ordinary');
    expect(stop).toHaveAttribute('data-ag-tone', 'neutral');
  });

  it('is reached by a toolbar’s arrow keys and keeps its reason while unavailable', async () => {
    const onStop = vi.fn();
    renderThemed(
      <ControlBar label="Transport">
        <ControlBarItem>
          <TransportButton icon="play" label="Play" main onClick={vi.fn()} />
        </ControlBarItem>
        <ControlBarItem>
          <TransportButton
            icon="stop"
            label="Stop"
            unavailableReason="Nothing is playing."
            onClick={onStop}
          />
        </ControlBarItem>
      </ControlBar>,
    );

    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}');
    const stop = screen.getByRole('button', { name: 'Stop' });
    expect(stop).toHaveFocus();
    expect(stop).toHaveAccessibleDescription('Nothing is playing.');

    await userEvent.keyboard('{Enter}');
    expect(onStop).not.toHaveBeenCalled();
  });
});
