import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderThemed } from '../testing/render-themed.js';
import { Button, ButtonTone } from './button.js';
import { IconButton } from './buttons/icon-button.js';

describe('Button', () => {
  it('is reachable and pressable by name', async () => {
    const onClick = vi.fn();
    renderThemed(<Button onClick={onClick}>Reset layout</Button>);

    await userEvent.click(screen.getByRole('button', { name: 'Reset layout' }));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it('activates from the keyboard', async () => {
    const onClick = vi.fn();
    renderThemed(<Button onClick={onClick}>Reset layout</Button>);

    await userEvent.tab();
    await userEvent.keyboard('{Enter}');

    expect(onClick).toHaveBeenCalledOnce();
  });

  it('names itself for a screen reader when it shows only an icon', () => {
    renderThemed(<Button iconOnly label="Play" />);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('does not submit the form it happens to sit in', () => {
    // A toolbar button that submits its surrounding form is a defect that only
    // appears once the form exists, so the type is explicit rather than
    // default.
    renderThemed(<Button>Zoom in</Button>);
    expect(screen.getByRole('button', { name: 'Zoom in' })).toHaveAttribute('type', 'button');
  });

  it('is not pressable while disabled', async () => {
    const onClick = vi.fn();
    renderThemed(
      <Button onClick={onClick} disabled>
        Delete
      </Button>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it('draws the tone it is given, the quiet destructive one among them', () => {
    renderThemed(<Button tone={ButtonTone.QuietDestructive}>Remove</Button>);
    expect(screen.getByRole('button', { name: 'Remove' })).toHaveAttribute(
      'data-ag-tone',
      'quiet-destructive',
    );
  });
});

describe('an unavailable button', () => {
  const REASON = 'There is nothing to undo.';

  it('stays in the tab order and says it is unavailable, described by its reason', async () => {
    renderThemed(
      <Button unavailableReason={REASON} onClick={vi.fn()}>
        Undo
      </Button>,
    );

    await userEvent.tab();
    const button = screen.getByRole('button', { name: 'Undo' });
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription(REASON);
  });

  it('runs nothing when pressed, by pointer or by key', async () => {
    const onClick = vi.fn();
    renderThemed(
      <Button unavailableReason={REASON} onClick={onClick}>
        Undo
      </Button>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await userEvent.keyboard('{Enter}');

    expect(onClick).not.toHaveBeenCalled();
  });

  it('opens its reason when focused', async () => {
    renderThemed(<Button unavailableReason={REASON}>Undo</Button>);

    await userEvent.tab();

    expect(await screen.findByRole('tooltip')).toHaveTextContent(REASON);
  });

  it('keeps its focus when it becomes unavailable while focused', async () => {
    // Were the hint composed only once there was a reason, the button would be
    // mounted again as its command became unavailable, and focus would fall to
    // the page under a keyboard user's hands.
    const { rerender } = renderThemed(<Button>Undo</Button>);
    await userEvent.tab();
    const before = screen.getByRole('button', { name: 'Undo' });
    expect(before).toHaveFocus();

    rerender(<Button unavailableReason={REASON}>Undo</Button>);

    const after = screen.getByRole('button', { name: 'Undo' });
    expect(after).toBe(before);
    expect(after).toHaveFocus();
  });

  it('keeps a description the caller gave beside its reason', () => {
    renderThemed(
      <>
        <p id="beside">Undo steps back one edit.</p>
        <Button unavailableReason={REASON} aria-describedby="beside">
          Undo
        </Button>
      </>,
    );

    expect(screen.getByRole('button', { name: 'Undo' })).toHaveAccessibleDescription(
      `Undo steps back one edit. ${REASON}`,
    );
  });
});

describe('a hinted button', () => {
  it('opens its hint and shortcut when focused', async () => {
    renderThemed(
      <Button hint="Start playback" shortcut="Space">
        Play
      </Button>,
    );

    await userEvent.tab();

    const hint = await screen.findByRole('tooltip');
    expect(hint).toHaveTextContent('Start playback');
    expect(hint).toHaveTextContent('Space');
  });
});

describe('IconButton', () => {
  it('is named by its label and draws its glyph', () => {
    renderThemed(<IconButton icon="close" label="Close" />);

    const button = screen.getByRole('button', { name: 'Close' });
    expect(button.querySelector('svg[data-icon="close"]')).not.toBeNull();
  });

  it('says whether the mode it toggles is on', () => {
    renderThemed(<IconButton icon="snap" label="Snap" pressed />);
    expect(screen.getByRole('button', { name: 'Snap' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('has no on state when it runs an action', () => {
    renderThemed(<IconButton icon="close" label="Close" />);
    expect(screen.getByRole('button', { name: 'Close' })).not.toHaveAttribute('aria-pressed');
  });
});
