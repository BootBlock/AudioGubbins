import { act, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_THEME_PREFERENCES, UNKNOWN_SYSTEM_APPEARANCE } from '../tokens/preferences.js';
import { ThemeProvider, fixedSystemAppearance } from '../theme/theme-provider.js';
import { ContextActions, HintProvider, type ContextActionsOpener } from './overlays.js';

/**
 * The context menu opened by an owner that recognises a long press itself.
 *
 * A file of its own for the reason `context-actions.test.tsx` gives: under
 * jsdom a menu opens once per file, so everything is checked within one
 * opening.
 */

/** A context event an engine reports for a finger held on the screen. */
function touchContextMenu(): MouseEvent {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'pointerType', { value: 'touch' });
  return event;
}

describe('ContextActions with an opener', () => {
  it('leaves a finger’s press to its owner, and opens where the owner says', () => {
    // Its own long press opened after 700 ms and was given up at the first
    // movement a finger or a pen reported, so it disagreed with the owner's
    // recogniser: a hold of 600 ms, or one that shifted by a pixel, abandoned
    // the tool's press and opened nothing.
    const opener = createRef<ContextActionsOpener>();
    render(
      <ThemeProvider
        preferences={DEFAULT_THEME_PREFERENCES}
        system={fixedSystemAppearance(UNKNOWN_SYSTEM_APPEARANCE)}
      >
        <HintProvider>
          <ContextActions
            label="Clip actions"
            opener={opener}
            groups={[{ key: 'clip', items: [{ key: 'split', label: 'Split', onSelect: vi.fn() }] }]}
          >
            <div>The waveform</div>
          </ContextActions>
        </HintProvider>
      </ThemeProvider>,
    );
    const surface = screen.getByText('The waveform');

    const press = new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      pointerType: 'touch',
    });
    const held = touchContextMenu();
    act(() => {
      surface.dispatchEvent(press);
      surface.dispatchEvent(held);
    });

    expect(press.defaultPrevented).toBe(true);
    expect(held.defaultPrevented).toBe(true);
    expect(screen.queryByRole('menu', { name: 'Clip actions' })).toBeNull();

    act(() => {
      opener.current?.openAt(40, 60);
    });

    expect(screen.getByRole('menu', { name: 'Clip actions' })).toBeInTheDocument();
  });
});
