import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { KeyboardConvention } from '@audiogubbins/commands';
import { keyboardLayout } from '@audiogubbins/input';

import { ShortcutRecorder } from './shortcut-recorder.js';

/**
 * The recorder takes each press from the page, so the listener that learns the
 * layout from every other press never sees one made here.
 */
describe('the shortcut recorder', () => {
  it('keeps Save reachable before anything is recorded, and says what to do', () => {
    // Given the native `disabled`, Save left the tab order whenever nothing
    // was recorded yet or the combination was one the platform takes, so a
    // keyboard user tabbed from the field straight past it with no sign that
    // it was there. Every other settings button that can be unavailable is
    // reachable with its reason beside it.
    const onSave = vi.fn();
    render(
      <ShortcutRecorder
        commandLabel="Open settings"
        convention={KeyboardConvention.Windows}
        layout={keyboardLayout([])}
        learnKey={vi.fn()}
        onSave={onSave}
        onCancel={() => undefined}
      />,
    );

    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).not.toBeDisabled();
    expect(save).toHaveAttribute('aria-disabled', 'true');
    expect(save).toHaveAccessibleDescription('Press the combination you want first.');

    save.focus();
    expect(save).toHaveFocus();
    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('says why Save cannot run while a combination the platform takes is recorded', () => {
    const onSave = vi.fn();
    // Dvorak types T at the key a US keyboard has K on, and the browser opens
    // a tab with Ctrl+T.
    render(
      <ShortcutRecorder
        commandLabel="Open settings"
        convention={KeyboardConvention.Windows}
        layout={keyboardLayout([['KeyK', 't']])}
        learnKey={vi.fn()}
        onSave={onSave}
        onCancel={() => undefined}
      />,
    );

    const field = screen.getByRole('textbox', { name: 'Shortcut for Open settings' });
    fireEvent.keyDown(field, { code: 'KeyK', key: 't', ctrlKey: true });
    fireEvent.keyDown(field, { code: 'Escape', key: 'Escape' });

    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toHaveAttribute('aria-disabled', 'true');
    // The reason the platform gives, not a sentence of the recorder's own:
    // "that cannot be used" tells the user nothing they can act on.
    expect(save).toHaveAccessibleDescription(
      'Ctrl+T cannot be used: The browser opens a tab, or reopens the last one closed, with it. Choose another.',
    );
    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('teaches the layout each press, and refuses what the browser takes by the character', () => {
    const learnKey = vi.fn();
    // Dvorak types T at the key a US keyboard has K on.
    const layout = keyboardLayout([['KeyK', 't']]);

    render(
      <ShortcutRecorder
        commandLabel="Open settings"
        convention={KeyboardConvention.Windows}
        layout={layout}
        learnKey={learnKey}
        onSave={() => undefined}
        onCancel={() => undefined}
      />,
    );

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Shortcut for Open settings' }), {
      code: 'KeyK',
      key: 't',
      ctrlKey: true,
    });

    expect(learnKey).toHaveBeenCalledWith(expect.objectContaining({ code: 'KeyK', key: 't' }));
    // Shown, and said in the recorder's live text.
    expect(screen.getAllByText(/^Ctrl\+T cannot be used: /)).toHaveLength(2);

    // And described by the instruction alone. With the live text named in the
    // field's description as well, the refusal was read once as it happened,
    // again on every return of focus to the field, and a third time by Save,
    // which carries the platform's reason itself.
    expect(
      screen.getByRole('textbox', { name: 'Shortcut for Open settings' }),
    ).toHaveAccessibleDescription(
      'Press the combination, one step at a time for a chord. Press Escape when you have finished.',
    );
  });
});
