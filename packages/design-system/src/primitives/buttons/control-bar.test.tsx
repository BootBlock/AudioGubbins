import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderThemed } from '../../testing/render-themed.js';
import { Button } from '../button.js';
import {
  ControlBar,
  ControlBarButton,
  ControlBarItem,
  ControlBarSeparator,
} from './control-bar.js';

describe('ControlBar', () => {
  it('names itself, so a screen reader can say which toolbar this is', () => {
    renderThemed(
      <ControlBar label="Transport">
        <Button>Play</Button>
      </ControlBar>,
    );

    expect(screen.getByRole('toolbar', { name: 'Transport' })).toBeInTheDocument();
  });

  it('costs a keyboard user one Tab stop, not one per button', async () => {
    renderThemed(
      <>
        <ControlBar label="Transport">
          <ControlBarItem>
            <Button>Play</Button>
          </ControlBarItem>
          <ControlBarItem>
            <Button>Stop</Button>
          </ControlBarItem>
          <ControlBarItem>
            <Button>Record</Button>
          </ControlBarItem>
        </ControlBar>
        <Button>After the toolbar</Button>
      </>,
    );

    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Play' })).toHaveFocus();

    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'After the toolbar' })).toHaveFocus();
  });

  it('moves between its buttons with the arrow keys', async () => {
    renderThemed(
      <ControlBar label="Transport">
        <ControlBarItem>
          <Button>Play</Button>
        </ControlBarItem>
        <ControlBarItem>
          <Button>Stop</Button>
        </ControlBarItem>
      </ControlBar>,
    );

    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}');

    expect(screen.getByRole('button', { name: 'Stop' })).toHaveFocus();
  });

  it('keeps a hinted button reachable, so one tooltip does not cost the toolbar its keyboard access', async () => {
    // A hint used to be wrapped around a toolbar item, which dropped the props
    // and the ref the toolbar gives its items. The toolbar then held an item
    // with no element behind it, and the first Tab threw instead of moving
    // focus, taking every button in the toolbar out of keyboard reach.
    renderThemed(
      <ControlBar label="Transport">
        <ControlBarButton label="Play" hint="Start playback" shortcut="Space" onPress={vi.fn()} />
        <ControlBarItem>
          <Button>Stop</Button>
        </ControlBarItem>
      </ControlBar>,
    );

    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Play' })).toHaveFocus();

    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'Stop' })).toHaveFocus();
  });

  it('runs a hinted button when it is pressed', async () => {
    const onPress = vi.fn();
    renderThemed(
      <ControlBar label="Transport">
        <ControlBarButton label="Play" hint="Start playback" onPress={onPress} />
      </ControlBar>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Play' }));

    expect(onPress).toHaveBeenCalledOnce();
  });

  it('opens a button’s hint when the arrow keys reach it', async () => {
    renderThemed(
      <ControlBar label="Zoom">
        <ControlBarButton label="Zoom in" onPress={vi.fn()} />
        <ControlBarButton label="Fit" hint="Show the whole sound" onPress={vi.fn()} />
      </ControlBar>,
    );

    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}');

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Show the whole sound');
  });

  it('draws a glyph button named by its label, and says whether its mode is on', () => {
    renderThemed(
      <ControlBar label="Editing">
        <ControlBarButton label="Snap" icon="snap" pressed onPress={vi.fn()} />
      </ControlBar>,
    );

    const snap = screen.getByRole('button', { name: 'Snap' });
    expect(snap).toHaveAttribute('aria-pressed', 'true');
    expect(snap.querySelector('svg[data-icon="snap"]')).not.toBeNull();
  });

  it('runs nothing from an unavailable button, which keeps its roving focus', async () => {
    const onPress = vi.fn();
    renderThemed(
      <ControlBar label="Editing">
        <ControlBarButton label="Undo" unavailableReason="Nothing to undo." onPress={onPress} />
        <ControlBarButton label="Redo" onPress={vi.fn()} />
      </ControlBar>,
    );

    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('{ArrowRight}');

    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Redo' })).toHaveFocus();
  });

  it('splits its groups with a separator', () => {
    renderThemed(
      <ControlBar label="Editing">
        <ControlBarButton label="Cut" onPress={vi.fn()} />
        <ControlBarSeparator />
        <ControlBarButton label="Undo" onPress={vi.fn()} />
      </ControlBar>,
    );

    expect(screen.getByRole('separator')).toBeInTheDocument();
  });
});
