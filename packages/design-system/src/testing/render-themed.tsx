/**
 * Renders a component as the application draws every control: inside a theme,
 * the hints and the notices. The theme writes the tokens and the state
 * attributes the stylesheets select on, the hints give a hinted control its
 * context, and a dialogue shows a notice raised while it is open, so it needs
 * the notices.
 */

import { render, type RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';

import { NoticeProvider } from '../primitives/announcement.js';
import { HintProvider } from '../primitives/overlays/tooltips.js';
import { ThemeProvider, fixedSystemAppearance } from '../theme/theme-provider.js';
import {
  DEFAULT_THEME_PREFERENCES,
  type MotionLevel,
  type ThemePreferences,
  UNKNOWN_SYSTEM_APPEARANCE,
} from '../tokens/preferences.js';

const SYSTEM = fixedSystemAppearance(UNKNOWN_SYSTEM_APPEARANCE);

/**
 * Renders `ui` themed with the shipped preferences, or with them at `motion`
 * when a test holds the motion level. A wrapper rather than a tree of its own,
 * so `rerender` draws the next `ui` inside the same theme and the controls it
 * already drew are updated rather than mounted again.
 */
export function renderThemed(ui: ReactNode, motion?: MotionLevel): RenderResult {
  const preferences: ThemePreferences =
    motion === undefined ? DEFAULT_THEME_PREFERENCES : { ...DEFAULT_THEME_PREFERENCES, motion };
  return render(ui, {
    wrapper: ({ children }: { readonly children: ReactNode }) => (
      <ThemeProvider preferences={preferences} system={SYSTEM}>
        <HintProvider>
          <NoticeProvider notice={undefined}>{children}</NoticeProvider>
        </HintProvider>
      </ThemeProvider>
    ),
  });
}
