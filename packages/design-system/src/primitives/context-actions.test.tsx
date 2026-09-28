import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_THEME_PREFERENCES, UNKNOWN_SYSTEM_APPEARANCE } from '../tokens/preferences.js';
import { ThemeProvider, fixedSystemAppearance } from '../theme/theme-provider.js';
import { ContextActions, HintProvider } from './overlays.js';

/**
 * The context menu REQ-UX-067 names as the long-press action in an editing
 * canvas.
 *
 * The canvas that uses it arrives with the waveform editor; the primitive is
 * this phase's, and is tested here. It has a file of its own because a menu
 * opened by a pointer event opens only once per file under jsdom, for the
 * reason `primitives.test.tsx` records, so everything the menu promises is
 * checked within one opening.
 */
describe('ContextActions', () => {
  it('opens on the context action, names itself, explains and runs its entries', async () => {
    const split = vi.fn();
    render(
      <ThemeProvider
        preferences={DEFAULT_THEME_PREFERENCES}
        system={fixedSystemAppearance(UNKNOWN_SYSTEM_APPEARANCE)}
      >
        <HintProvider>
          <ContextActions
            label="Clip actions"
            groups={[
              {
                key: 'clip',
                items: [
                  { key: 'split', label: 'Split here', onSelect: split },
                  {
                    key: 'delete',
                    label: 'Delete clip',
                    unavailableReason: 'Nothing is selected.',
                    onSelect: vi.fn(),
                  },
                ],
              },
            ]}
          >
            <div>The waveform</div>
          </ContextActions>
        </HintProvider>
      </ThemeProvider>,
    );

    // What a browser sends for a right click. A long press is not this event
    // everywhere: Safari on iOS sends none, and the primitive opens itself from
    // a touch or pen press held past its delay. That path is tested with the
    // first surface that mounts the primitive, Phase 04's waveform canvas.
    fireEvent.contextMenu(screen.getByText('The waveform'));

    expect(await screen.findByRole('menu', { name: 'Clip actions' })).toBeInTheDocument();

    const unavailable = screen.getByRole('menuitem', { name: /Delete clip/ });
    expect(unavailable).toHaveAccessibleName(/Nothing is selected\./);
    expect(unavailable).toHaveAttribute('aria-disabled', 'true');

    await userEvent.click(screen.getByRole('menuitem', { name: 'Split here' }));
    expect(split).toHaveBeenCalledOnce();
  });
});
