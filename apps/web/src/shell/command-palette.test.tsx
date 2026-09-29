import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { KeyboardConvention } from '@audiogubbins/commands';
import { NoticeProvider } from '@audiogubbins/design-system';

import { shellCommands } from '../commands/shell-commands.js';
import { buildLayoutStore } from '../testing/layout-store.js';
import { DESCRIPTORS, buildShellContext } from '../testing/shell-context.js';
import { CommandPalette } from './command-palette.js';

/** Renders inside the notices, as the application renders every dialogue. */
function renderInTheShell(ui: ReactNode): ReturnType<typeof render> {
  return render(<NoticeProvider notice={undefined}>{ui}</NoticeProvider>);
}

describe('the command palette', () => {
  it('writes each shortcut in the characters the keyboard types', () => {
    // On Dvorak the key at V types K and the key at R types P. Written at the
    // keys' US names, the palette's own shortcut read Ctrl+V, Ctrl+R.
    const keyboard = buildLayoutStore().store;
    keyboard.adopt([
      ['KeyK', 't'],
      ['KeyV', 'k'],
      ['KeyR', 'p'],
    ]);
    const { context } = buildShellContext(undefined, KeyboardConvention.Windows, keyboard);

    renderInTheShell(
      <CommandPalette
        open
        onClose={() => undefined}
        commands={shellCommands(DESCRIPTORS)}
        context={context}
        profile={context.shortcuts.get().profile}
        convention={context.convention}
        layout={keyboard.get()}
        onRun={() => undefined}
      />,
    );

    const entry = screen.getByRole('option', { name: /^Show the command palette/ });
    expect(within(entry).getByText('Ctrl+K, Ctrl+P')).toBeInTheDocument();
  });

  it('announces the result count once the reader stops typing, as a whole sentence', async () => {
    // A polite region queues rather than replaces, so a count that changed on
    // every keystroke read the whole run out before the number the reader
    // wanted: typing eight characters queued eight sentences.
    vi.useFakeTimers();
    try {
      const keyboard = buildLayoutStore().store;
      const { context } = buildShellContext(undefined, KeyboardConvention.Windows, keyboard);

      renderInTheShell(
        <CommandPalette
          open
          onClose={() => undefined}
          commands={shellCommands(DESCRIPTORS)}
          context={context}
          profile={context.shortcuts.get().profile}
          convention={context.convention}
          layout={keyboard.get()}
          onRun={() => undefined}
        />,
      );

      // The palette's own region, not the one the notices keep for the page.
      const region = screen.getByRole('dialog').querySelector('[aria-live="polite"]');
      expect(region).not.toBeNull();
      expect(region?.textContent).toBe('');
      expect(region).toHaveAttribute('aria-atomic', 'true');

      // Nothing is said while the reader is still typing: each key starts the
      // wait again, so a pause a moment short of it says nothing.
      const search = screen.getByRole('combobox', { name: 'Search commands' });
      fireEvent.change(search, { target: { value: 'theme' } });
      act(() => {
        vi.advanceTimersByTime(499);
      });
      expect(region?.textContent).toBe('');
      fireEvent.change(search, { target: { value: 'workspace' } });
      act(() => {
        vi.advanceTimersByTime(499);
      });
      expect(region?.textContent).toBe('');

      await act(async () => {
        vi.advanceTimersByTime(1);
        await Promise.resolve();
      });

      expect(region?.textContent).toBe('8 commands match.');
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs the command a row names on the release, so a wrong press can be called off', () => {
    // Run on the press, it could not be called off: a user with a tremor, a
    // head pointer or an imprecise touch could not slide off the wrong row,
    // and this phase has no undo (WCAG 2.5.2). The press is still refused, so
    // that focus stays in the search field.
    const keyboard = buildLayoutStore().store;
    const { context } = buildShellContext(undefined, KeyboardConvention.Windows, keyboard);
    const onRun = vi.fn();
    const onClose = vi.fn();

    renderInTheShell(
      <CommandPalette
        open
        onClose={onClose}
        commands={shellCommands(DESCRIPTORS)}
        context={context}
        profile={context.shortcuts.get().profile}
        convention={context.convention}
        layout={keyboard.get()}
        onRun={onRun}
      />,
    );

    const entry = screen.getByRole('option', { name: /^Show the command palette/ });
    const pressed = fireEvent.pointerDown(entry, { pointerType: 'mouse' });
    expect(onRun).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // Refused, so that the field keeps focus.
    expect(pressed).toBe(false);

    // A mouse and nothing else. A refused press takes with it the click an
    // engine synthesises from a tap, so a row tapped with a finger or a pencil
    // ran nothing at all. Refused for touch alone, a pencil still took that
    // route: iPadOS delivers one through the touch pipeline and reports `pen`.
    expect(fireEvent.pointerDown(entry, { pointerType: 'touch' })).toBe(true);
    expect(fireEvent.pointerDown(entry, { pointerType: 'pen' })).toBe(true);
    expect(onRun).not.toHaveBeenCalled();

    fireEvent.click(entry);
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
